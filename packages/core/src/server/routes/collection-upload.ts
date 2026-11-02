import type { Context } from 'hono'
import { fileTypeFromBuffer } from 'file-type'
import type { z } from 'zod'
import type { AuthUser, LontarVariables } from '../../auth/types'
import type { AccessArgs, AccessFunction, CollectionConfig, Config } from '../../config/types'
import type { DatabaseAdapter, DocumentData } from '../../database/adapter'
import type { Field } from '../../fields/types'
import { parseDepth, populateDoc } from '../../populate'
import {
  DEFAULT_MAX_FILE_SIZE,
  deleteMedia,
  getUniqueFilename,
  InvalidImageError,
  sanitizeFilename,
  uploadMedia,
  type UploadedMediaDoc,
} from '../../storage'

type LontarEnv = { Variables: LontarVariables }

export const DANGEROUS_MIME_TYPES = new Set([
  'text/html',
  'image/svg+xml',
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
])

export function isMultipartRequest(c: Context<LontarEnv>): boolean {
  const contentType = c.req.header('content-type') ?? ''
  return contentType.includes('multipart/form-data')
}

export function isUploadFile(val: unknown): val is File {
  return (
    val !== null &&
    typeof val === 'object' &&
    'arrayBuffer' in val &&
    typeof val.arrayBuffer === 'function'
  )
}

function matchesMimePattern(actual: string, pattern: string): boolean {
  if (pattern === '*/*') return true
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1)
    return actual.startsWith(prefix)
  }
  return actual.toLowerCase() === pattern.toLowerCase()
}

export function isAllowedMimeType(mimeType: string, allowed?: string[]): boolean {
  const lowerMime = mimeType.toLowerCase()
  if (DANGEROUS_MIME_TYPES.has(lowerMime)) {
    if (!allowed || allowed.length === 0) return false
    return allowed.some((p) => p.toLowerCase() === lowerMime)
  }
  if (!allowed || allowed.length === 0) return true
  return allowed.some((pattern) => matchesMimePattern(lowerMime, pattern))
}

function hasScriptContent(sample: string): boolean {
  return (
    sample.includes('<script') ||
    sample.includes('</script') ||
    sample.includes('javascript:') ||
    sample.includes('onload=') ||
    sample.includes('onerror=')
  )
}

function hasHtmlContent(sample: string): boolean {
  return sample.includes('<html') || sample.includes('<!doctype html')
}

function hasSvgContent(sample: string): boolean {
  return sample.includes('<svg') || sample.includes('xmlns="http://www.w3.org/2000/svg"')
}

function inspectBufferForDangerousContent(
  buffer: Buffer,
  allowed?: string[],
): { safe: true } | { safe: false; error: string } {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('utf8').toLowerCase()

  if (hasScriptContent(sample)) {
    return { safe: false, error: 'Files containing executable scripts are not allowed' }
  }

  if (hasHtmlContent(sample)) {
    const isHtmlExplicit = allowed?.some(
      (m) => m.toLowerCase() === 'text/html' || m.toLowerCase() === 'application/xhtml+xml',
    )
    if (!isHtmlExplicit) {
      return { safe: false, error: 'HTML file content is not allowed' }
    }
  }

  if (hasSvgContent(sample)) {
    const isSvgExplicit = allowed?.some((m) => m.toLowerCase() === 'image/svg+xml')
    if (!isSvgExplicit) {
      return { safe: false, error: 'SVG file content is not allowed' }
    }
  }

  return { safe: true }
}

function isClientImageClaim(clientMime: string): boolean {
  const lower = clientMime.toLowerCase()
  return lower.startsWith('image/') && lower !== 'image/svg+xml'
}

function validateImageMime(clientMime: string, sniffedMime?: string): boolean {
  if (!isClientImageClaim(clientMime)) return true
  if (!sniffedMime || !sniffedMime.toLowerCase().startsWith('image/')) {
    return false
  }
  return true
}

function parseNumericField(val: string): number | string {
  const num = Number(val)
  return isNaN(num) ? val : num
}

function parseBooleanField(val: string): boolean {
  return val === 'true' || val === '1' || val === 'on'
}

function parseJsonField(val: string): unknown {
  try {
    return JSON.parse(val)
  } catch {
    return val
  }
}

function parseRelationshipField(val: string, hasMany?: boolean): unknown {
  if (hasMany) {
    try {
      return JSON.parse(val)
    } catch {
      return val.split(',').map((s) => Number(s.trim()))
    }
  }
  return parseNumericField(val)
}

function parseStringField(val: string, field: Field): unknown {
  switch (field.type) {
    case 'number':
    case 'upload':
      return parseNumericField(val)
    case 'checkbox':
      return parseBooleanField(val)
    case 'richText':
      return parseJsonField(val)
    case 'relationship':
      return parseRelationshipField(val, field.hasMany)
    default:
      return val
  }
}

function parseFieldValue(val: unknown, field: Field): unknown {
  if (val === undefined || val === null || val === '') {
    return field.required ? '' : null
  }
  if (typeof val !== 'string') return val
  return parseStringField(val, field)
}

export function parseFormDataFields(
  rawBody: Record<string, unknown>,
  fields: Record<string, Field>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(fields)) {
    if (name in rawBody) {
      result[name] = parseFieldValue(rawBody[name], field)
    }
  }
  return result
}

async function safeDeleteMedia(
  config: Config,
  doc: { filename: string; sizes?: unknown },
): Promise<void> {
  if (!config.storage) return
  try {
    await deleteMedia({
      storage: config.storage,
      filename: doc.filename,
      sizes: doc.sizes as Record<string, { filename: string }> | undefined,
    })
  } catch {
    // Non-fatal cleanup error
  }
}

async function rollbackNewMedia(config: Config, uploadDoc?: UploadedMediaDoc): Promise<void> {
  if (uploadDoc) {
    await safeDeleteMedia(config, uploadDoc)
  }
}

type ProcessFileResult =
  { ok: true; uploadDoc: UploadedMediaDoc } | { ok: false; error: string; status: 400 | 413 | 500 }

function validateFileSize(fileSize: number, maxFileSize: number): string | null {
  if (fileSize > maxFileSize) {
    return `File size exceeds limit of ${maxFileSize} bytes`
  }
  return null
}

function resolveEffectiveMime(
  file: File,
  sniffed?: { ext: string; mime: string },
): { effectiveMime: string; extSuffix: string } {
  if (sniffed) {
    return { effectiveMime: sniffed.mime, extSuffix: sniffed.ext }
  }
  const sanitized = sanitizeFilename(file.name || 'unnamed')
  return { effectiveMime: file.type || 'application/octet-stream', extSuffix: sanitized.ext }
}

async function prepareUploadFilename(args: {
  db: DatabaseAdapter
  collection: CollectionConfig
  file: File
  extSuffix: string
  excludeDocId?: number
}): Promise<string> {
  const { base } = sanitizeFilename(args.file.name || 'unnamed')
  return getUniqueFilename({
    db: args.db,
    collection: args.collection,
    base,
    ext: args.extSuffix,
    excludeDocId: args.excludeDocId,
  })
}

async function readAndValidateUploadBuffer(
  file: File,
  maxFileSize: number,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string; status: 413 }> {
  const sizeErr = validateFileSize(file.size, maxFileSize)
  if (sizeErr) return { ok: false, error: sizeErr, status: 413 }

  const buffer = Buffer.from(await file.arrayBuffer())
  const bufSizeErr = validateFileSize(buffer.length, maxFileSize)
  if (bufSizeErr) return { ok: false, error: bufSizeErr, status: 413 }

  return { ok: true, buffer }
}

async function validateUploadMime(
  file: File,
  buffer: Buffer,
  mimeTypes?: string[],
): Promise<
  { ok: true; effectiveMime: string; extSuffix: string } | { ok: false; error: string; status: 400 }
> {
  const sniffed = await fileTypeFromBuffer(buffer)
  const clientMime = file.type || 'application/octet-stream'
  if (!validateImageMime(clientMime, sniffed?.mime)) {
    return {
      ok: false,
      error: 'Invalid image: file content does not match image format',
      status: 400,
    }
  }

  const { effectiveMime, extSuffix } = resolveEffectiveMime(file, sniffed)
  if (!isAllowedMimeType(effectiveMime, mimeTypes)) {
    return { ok: false, error: `File type "${effectiveMime}" is not allowed`, status: 400 }
  }

  if (!sniffed?.mime.toLowerCase().startsWith('image/')) {
    const inspection = inspectBufferForDangerousContent(buffer, mimeTypes)
    if (!inspection.safe) return { ok: false, error: inspection.error, status: 400 }
  }

  return { ok: true, effectiveMime, extSuffix }
}

async function uploadMediaFile(args: {
  storage: Config['storage']
  collection: CollectionConfig
  filename: string
  buffer: Buffer
  effectiveMime: string
}): Promise<ProcessFileResult> {
  if (!args.storage) {
    return { ok: false, error: 'Storage adapter is not configured', status: 500 }
  }
  const contentDisposition = args.effectiveMime.toLowerCase().startsWith('image/')
    ? undefined
    : `attachment; filename="${args.filename}"`

  try {
    const uploadDoc = await uploadMedia({
      storage: args.storage,
      file: {
        filename: args.filename,
        buffer: args.buffer,
        mimeType: args.effectiveMime,
        contentDisposition,
      },
      uploadConfig: args.collection.upload,
    })
    return { ok: true, uploadDoc }
  } catch (err) {
    if (err instanceof InvalidImageError) {
      return { ok: false, error: 'Invalid image', status: 400 }
    }
    return { ok: false, error: 'Upload failed', status: 500 }
  }
}

async function processIncomingFile(
  file: File,
  collection: CollectionConfig,
  config: Config,
  excludeDocId?: number,
): Promise<ProcessFileResult> {
  if (!config.storage) {
    return { ok: false, error: 'Storage adapter is not configured', status: 500 }
  }
  const uploadConfig = typeof collection.upload === 'object' ? collection.upload : undefined
  const maxFileSize = uploadConfig?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE

  const bufResult = await readAndValidateUploadBuffer(file, maxFileSize)
  if (!bufResult.ok) return bufResult

  const mimeResult = await validateUploadMime(file, bufResult.buffer, uploadConfig?.mimeTypes)
  if (!mimeResult.ok) return mimeResult

  const filename = await prepareUploadFilename({
    db: config.db,
    collection,
    file,
    extSuffix: mimeResult.extSuffix,
    excludeDocId,
  })

  return uploadMediaFile({
    storage: config.storage,
    collection,
    filename,
    buffer: bufResult.buffer,
    effectiveMime: mimeResult.effectiveMime,
  })
}

function shouldDeleteVariant(
  variant: { filename?: string } | undefined,
  newVariantFilenames: Set<string>,
  mainFilename: string,
): variant is { filename: string } {
  if (!variant?.filename) return false
  if (newVariantFilenames.has(variant.filename)) return false
  return variant.filename !== mainFilename
}

async function cleanupOldSizes(
  storage: Config['storage'],
  oldSizes: unknown,
  newSizes: unknown,
  mainFilename: string,
): Promise<void> {
  if (!storage || !oldSizes || typeof oldSizes !== 'object') return
  const newSizesObj = (newSizes as Record<string, { filename: string }> | undefined) ?? {}
  const newVariantFilenames = new Set(Object.values(newSizesObj).map((v) => v.filename))

  for (const variant of Object.values(oldSizes as Record<string, { filename: string }>)) {
    if (shouldDeleteVariant(variant, newVariantFilenames, mainFilename)) {
      try {
        await storage.delete(variant.filename)
      } catch {
        // Non-fatal cleanup error
      }
    }
  }
}

async function cleanupReplacedMedia(
  config: Config,
  originalDoc: DocumentData,
  newUploadDoc?: UploadedMediaDoc,
): Promise<void> {
  if (!newUploadDoc || typeof originalDoc.filename !== 'string') return

  if (originalDoc.filename !== newUploadDoc.filename) {
    await safeDeleteMedia(config, {
      filename: originalDoc.filename,
      sizes: originalDoc.sizes,
    })
    return
  }

  await cleanupOldSizes(config.storage, originalDoc.sizes, newUploadDoc.sizes, originalDoc.filename)
}

function parseAndValidateFields(
  rawBody: Record<string, unknown>,
  collection: CollectionConfig,
  schema: z.ZodType,
): { success: true; data: DocumentData } | { success: false; issues: z.ZodIssue[] } {
  const parsedFields = parseFormDataFields(rawBody, collection.fields)
  const parsed = schema.safeParse(parsedFields)
  if (!parsed.success) {
    return { success: false, issues: parsed.error.issues }
  }
  return { success: true, data: parsed.data as DocumentData }
}

async function respondPopulatedDoc(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
  doc: DocumentData,
  user: AuthUser | null,
  status: 200 | 201,
): Promise<Response> {
  const depth = parseDepth(c.req.query('depth'))
  const populated = await populateDoc(doc, {
    collection,
    depth,
    collections: config.collections,
    db: config.db,
    user,
    req: c.req.raw,
  })
  return c.json(populated, status)
}

interface UploadCreateContext {
  c: Context<LontarEnv>
  collection: CollectionConfig
  config: Config
  schema: z.ZodType
  user: AuthUser | null
  checkAccess: (fn: AccessFunction | undefined, args: AccessArgs) => Promise<boolean>
  accessDenied: (c: Context<LontarEnv>, user: AuthUser | null) => Response
  executeCreate: (args: {
    collection: CollectionConfig
    db: DatabaseAdapter
    data: DocumentData
    req: Request
  }) => Promise<{ doc?: DocumentData; error?: string }>
}

export async function handleUploadCreate(ctx: UploadCreateContext): Promise<Response> {
  const { c, collection, config, schema, user, checkAccess, accessDenied, executeCreate } = ctx

  const preliminaryAllowed = await checkAccess(collection.access?.create, { user })
  if (!preliminaryAllowed) {
    return accessDenied(c, user)
  }

  const rawBody = (await c.req.parseBody()) as Record<string, unknown>
  const allowed = await checkAccess(collection.access?.create, { user, data: rawBody })
  if (!allowed) {
    return accessDenied(c, user)
  }

  if (!isUploadFile(rawBody.file)) {
    return c.json({ error: 'No file provided in upload request' }, 400)
  }

  const processed = await processIncomingFile(rawBody.file, collection, config)
  if (!processed.ok) {
    return c.json({ error: processed.error }, processed.status)
  }

  const validation = parseAndValidateFields(rawBody, collection, schema)
  if (!validation.success) {
    await safeDeleteMedia(config, processed.uploadDoc)
    return c.json({ error: 'Validation failed', issues: validation.issues }, 400)
  }

  const payload: DocumentData = { ...validation.data, ...processed.uploadDoc }
  const result = await executeCreate({
    collection,
    data: payload,
    db: config.db,
    req: c.req.raw,
  })

  if (!result.doc) {
    await safeDeleteMedia(config, processed.uploadDoc)
    return c.json({ error: result.error ?? 'Create operation failed' }, 400)
  }

  return respondPopulatedDoc(c, collection, config, result.doc, user, 201)
}

interface UploadUpdateContext {
  c: Context<LontarEnv>
  id: number
  collection: CollectionConfig
  config: Config
  partialSchema: z.ZodType
  user: AuthUser | null
  checkAccess: (fn: AccessFunction | undefined, args: AccessArgs) => Promise<boolean>
  accessDenied: (c: Context<LontarEnv>, user: AuthUser | null) => Response
  executeUpdate: (args: {
    collection: CollectionConfig
    db: DatabaseAdapter
    id: number
    originalDoc: DocumentData
    data: DocumentData
    req: Request
  }) => Promise<{ doc?: DocumentData; error?: string }>
}

async function processOptionalUploadFile(
  fileVal: unknown,
  collection: CollectionConfig,
  config: Config,
  id: number,
): Promise<
  { ok: true; doc?: UploadedMediaDoc } | { ok: false; error: string; status: 400 | 413 | 500 }
> {
  if (!isUploadFile(fileVal)) {
    return { ok: true }
  }
  const processed = await processIncomingFile(fileVal, collection, config, id)
  if (!processed.ok) {
    return { ok: false, error: processed.error, status: processed.status }
  }
  return { ok: true, doc: processed.uploadDoc }
}

async function applyValidatedUpdate(args: {
  ctx: UploadUpdateContext
  originalDoc: DocumentData
  validation: { success: true; data: DocumentData }
  newUploadDoc?: UploadedMediaDoc
}): Promise<Response> {
  const { c, id, collection, config, user, executeUpdate } = args.ctx
  const updateData: DocumentData = {
    ...args.validation.data,
    ...(args.newUploadDoc ? args.newUploadDoc : {}),
  }

  const result = await executeUpdate({
    collection,
    data: updateData,
    db: config.db,
    id,
    originalDoc: args.originalDoc,
    req: c.req.raw,
  })

  if (!result.doc) {
    await rollbackNewMedia(config, args.newUploadDoc)
    const err = result.error ? result.error : 'Update operation failed'
    return c.json({ error: err }, 400)
  }

  await cleanupReplacedMedia(config, args.originalDoc, args.newUploadDoc)
  return respondPopulatedDoc(c, collection, config, result.doc, user, 200)
}

export async function handleUploadUpdate(ctx: UploadUpdateContext): Promise<Response> {
  const { c, id, collection, config, partialSchema, user, checkAccess, accessDenied } = ctx

  const preliminaryAllowed = await checkAccess(collection.access?.update, { user, id })
  if (!preliminaryAllowed) {
    return accessDenied(c, user)
  }

  const rawBody = (await c.req.parseBody()) as Record<string, unknown>
  const allowed = await checkAccess(collection.access?.update, { user, id, data: rawBody })
  if (!allowed) {
    return accessDenied(c, user)
  }

  const originalDoc = await config.db.findByID({ collection, id })
  if (!originalDoc) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }

  const uploadResult = await processOptionalUploadFile(rawBody.file, collection, config, id)
  if (!uploadResult.ok) {
    return c.json({ error: uploadResult.error }, uploadResult.status)
  }

  const validation = parseAndValidateFields(rawBody, collection, partialSchema)
  if (!validation.success) {
    await rollbackNewMedia(config, uploadResult.doc)
    return c.json({ error: 'Validation failed', issues: validation.issues }, 400)
  }

  return applyValidatedUpdate({
    ctx,
    originalDoc,
    validation,
    newUploadDoc: uploadResult.doc,
  })
}

export async function handleUploadDelete(
  collection: CollectionConfig,
  config: Config,
  doc: DocumentData,
): Promise<void> {
  if (!collection.upload || !config.storage) return
  if (typeof doc.filename === 'string') {
    await safeDeleteMedia(config, {
      filename: doc.filename,
      sizes: doc.sizes,
    })
  }
}
