import type { Context } from 'hono'
import { fileTypeFromBuffer } from 'file-type'
import type { z } from 'zod'
import { accessDenied, resolveAccess, sanitizeDocRead, sanitizeDocWrite } from '../../access'
import type { AuthUser, LontarVariables } from '../../auth/types'
import { clientFieldsToZod } from '../../client'
import { AccessDeniedError, NotFoundError } from '../../operations/errors'
import { assertRowAccess } from '../../operations/row-access'
import { toClientCollection } from '../../config/to-client-config'
import type {
  AccessArgs,
  AccessFunction,
  CollectionConfig,
  Config,
  ConstraintAccessFunction,
} from '../../config/types'
import type { Where } from '../../query/types'
import type { DatabaseAdapter, DocumentData } from '../../database/adapter'
import type { Field } from '../../fields/types'
import { runBeforeValidateHooks } from '../../hooks'
import {
  type MutationExecutionResult,
  resolveCreateStatus,
  resolveDraftFlag,
  resolveLocaleOriginalDoc,
  resolveOriginalDoc,
  resolveUpdateStatus,
} from '../../operations/mutation'
import { ValidationError } from '../../operations/errors'
import { extractLocaleCodes, resolveOperationLocale } from '../../operations/locale'
import { parseDepth, populateDoc } from '../../populate'
import {
  DEFAULT_MAX_FILE_SIZE,
  deleteMedia,
  getUniqueFilename,
  InvalidImageError,
  StorageUploadError,
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
  if (field.localized && (val.startsWith('{') || val.startsWith('['))) {
    try {
      return JSON.parse(val)
    } catch {
      // not valid JSON, treat as raw string
    }
  }
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
  forDraft?: boolean
}): Promise<string> {
  const { base } = sanitizeFilename(args.file.name || 'unnamed')
  return getUniqueFilename({
    db: args.db,
    collection: args.collection,
    base,
    ext: args.extSuffix,
    excludeDocId: args.excludeDocId,
    forDraft: args.forDraft,
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
      collectionSlug: args.collection.slug,
    })
    return { ok: true, uploadDoc }
  } catch (err) {
    if (err instanceof InvalidImageError) {
      return { ok: false, error: 'Invalid image', status: 400 }
    }
    if (err instanceof StorageUploadError) {
      return { ok: false, error: 'Upload failed', status: 500 }
    }
    return { ok: false, error: 'Upload failed', status: 500 }
  }
}

async function processIncomingFile(
  file: File,
  collection: CollectionConfig,
  config: Config,
  excludeDocId?: number,
  forDraft?: boolean,
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
    forDraft,
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

export async function cleanupReplacedMedia(
  config: Config,
  originalDoc: DocumentData,
  newUploadDoc?: { filename?: unknown; sizes?: unknown },
): Promise<void> {
  if (
    !newUploadDoc ||
    typeof originalDoc.filename !== 'string' ||
    typeof newUploadDoc.filename !== 'string'
  ) {
    return
  }

  if (originalDoc.filename !== newUploadDoc.filename) {
    await safeDeleteMedia(config, {
      filename: originalDoc.filename,
      sizes: originalDoc.sizes,
    })
    return
  }

  await cleanupOldSizes(config.storage, originalDoc.sizes, newUploadDoc.sizes, originalDoc.filename)
}

async function applyBeforeValidateOnFormData(
  collection: CollectionConfig,
  parsedFields: DocumentData,
  hookArgs: {
    operation: 'create' | 'update'
    originalDoc?: DocumentData
    req?: Request
    draft?: boolean
    locale?: string
  },
): Promise<DocumentData> {
  const { _status: _ignoredStatus, ...cleanFields } = parsedFields
  const isCreate = hookArgs.operation === 'create'
  const createInfo = isCreate
    ? resolveCreateStatus(collection, cleanFields, hookArgs.draft)
    : undefined
  const updateInfo = !isCreate
    ? resolveUpdateStatus({
        collection,
        data: cleanFields,
        originalDoc: hookArgs.originalDoc ?? {},
        draft: hookArgs.draft,
      })
    : undefined

  return runBeforeValidateHooks({
    collection,
    data: cleanFields,
    operation: hookArgs.operation,
    originalDoc: hookArgs.originalDoc,
    status: createInfo ? createInfo.status : updateInfo?.status,
    previousStatus: updateInfo?.previousStatus,
    statusTransition: createInfo ? createInfo.statusTransition : updateInfo?.statusTransition,
    req: hookArgs.req,
    locale: hookArgs.locale,
  })
}

async function parseAndValidateFields(
  rawBody: Record<string, unknown>,
  collection: CollectionConfig,
  schema: z.ZodType,
  hookArgs?: {
    operation: 'create' | 'update'
    originalDoc?: DocumentData
    req?: Request
    draft?: boolean
    user?: AuthUser | null
    locale?: string
  },
): Promise<{ success: true; data: DocumentData } | { success: false; issues: z.ZodIssue[] }> {
  let parsedFields = parseFormDataFields(rawBody, collection.fields)
  if (hookArgs?.user !== undefined) {
    parsedFields = await sanitizeDocWrite(collection.fields, parsedFields, hookArgs.operation, {
      user: hookArgs.user,
      id: hookArgs.originalDoc?.id as string | number | undefined,
      data: parsedFields,
      doc: hookArgs.originalDoc,
      locale: hookArgs.locale,
    })
  }
  if (hookArgs) {
    parsedFields = await applyBeforeValidateOnFormData(collection, parsedFields, hookArgs)
  }

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
  locale?: string,
  fallbackLocale?: string | false,
): Promise<Response> {
  const depth = parseDepth(c.req.query('depth'))
  const draft = c.req.query('draft') === 'true'
  const populated = await populateDoc(doc, {
    collection,
    depth,
    collections: config.collections,
    localization: config.localization,
    db: config.db,
    user,
    req: c.req.raw,
    draft,
    locale,
    fallbackLocale,
  })
  const sanitized = await sanitizeDocRead(collection.fields, populated, user, {
    id: doc.id as string | number | undefined,
    doc: populated,
    req: c.req.raw,
    locale,
  })
  return c.json(sanitized, status)
}

interface UploadCreateContext {
  c: Context<LontarEnv>
  collection: CollectionConfig
  config: Config
  schema: z.ZodType
  user: AuthUser | null
  checkAccess: (
    fn: AccessFunction | ConstraintAccessFunction | undefined,
    args: AccessArgs,
  ) => Promise<boolean>
  accessDenied: (c: Context<LontarEnv>, user: AuthUser | null) => Response
  executeCreate: (args: {
    collection: CollectionConfig
    db: DatabaseAdapter
    data: DocumentData
    req?: Request
    draft?: boolean
    autosave?: boolean
    userId?: string | null
    config?: Config
    locale?: string
  }) => Promise<MutationExecutionResult>
}

async function applyValidatedCreate(args: {
  ctx: UploadCreateContext
  validationData: DocumentData
  uploadDoc: UploadedMediaDoc
  draft: boolean
  autosave: boolean
  locale?: string
  fallbackLocale?: string | false
}): Promise<Response> {
  const { c, collection, config, user, executeCreate } = args.ctx
  const payload: DocumentData = { ...args.validationData, ...args.uploadDoc }
  let result: MutationExecutionResult
  try {
    result = await executeCreate({
      collection,
      data: payload,
      db: config.db,
      req: c.req.raw,
      draft: args.draft,
      autosave: args.autosave,
      userId: user?.id,
      config,
      locale: args.locale,
    })
  } catch (err) {
    await safeDeleteMedia(config, args.uploadDoc)
    throw err
  }

  if (!result.success) {
    await safeDeleteMedia(config, args.uploadDoc)
    return c.json(result.body, result.status)
  }

  return respondPopulatedDoc(
    c,
    collection,
    config,
    result.doc,
    user,
    201,
    args.locale,
    args.fallbackLocale,
  )
}

function resolveUploadLocale(
  config: Config,
  c: Context<LontarEnv>,
): { locale?: string; fallbackLocale?: string | false; errorResponse?: Response } {
  try {
    const resolved = resolveOperationLocale(
      config,
      c.req.query('locale'),
      c.req.query('fallbackLocale'),
    )
    return { locale: resolved.locale, fallbackLocale: resolved.fallbackLocale }
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        errorResponse: c.json(
          { error: 'Validation failed', message: err.message, issues: err.issues },
          400,
        ),
      }
    }
    throw err
  }
}

export async function handleUploadCreate(ctx: UploadCreateContext): Promise<Response> {
  const { c, collection, config, user, checkAccess, accessDenied } = ctx

  const localeResult = resolveUploadLocale(config, c)
  if (localeResult.errorResponse) {
    return localeResult.errorResponse
  }
  const { locale, fallbackLocale } = localeResult

  const preliminaryAllowed = await checkAccess(collection.access?.create, {
    user,
    locale,
    req: c.req.raw,
  })
  if (!preliminaryAllowed) {
    return accessDenied(c, user)
  }

  const rawBody = (await c.req.parseBody()) as Record<string, unknown>
  const allowed = await checkAccess(collection.access?.create, {
    user,
    data: rawBody,
    locale,
    req: c.req.raw,
  })
  if (!allowed) {
    return accessDenied(c, user)
  }

  if (!isUploadFile(rawBody.file)) {
    return c.json({ error: 'No file provided in upload request' }, 400)
  }

  const draftQuery = c.req.query('draft') === 'true'
  const autosaveQuery = c.req.query('autosave') === 'true'
  const draft = resolveDraftFlag(collection, draftQuery, autosaveQuery)

  const processed = await processIncomingFile(
    rawBody.file,
    collection,
    config,
    undefined,
    Boolean(draft),
  )
  if (!processed.ok) {
    return c.json({ error: processed.error }, processed.status)
  }

  const locales = extractLocaleCodes(config)
  const schema = clientFieldsToZod(toClientCollection(collection).fields, { locale, locales })

  const validation = await parseAndValidateFields(rawBody, collection, schema, {
    operation: 'create',
    req: c.req.raw,
    draft: Boolean(draft),
    user,
    locale,
  })
  if (!validation.success) {
    await safeDeleteMedia(config, processed.uploadDoc)
    return c.json({ error: 'Validation failed', issues: validation.issues }, 400)
  }

  return applyValidatedCreate({
    ctx,
    validationData: validation.data,
    uploadDoc: processed.uploadDoc,
    draft: Boolean(draft),
    autosave: autosaveQuery,
    locale,
    fallbackLocale,
  })
}

interface UploadUpdateContext {
  c: Context<LontarEnv>
  id: number
  collection: CollectionConfig
  config: Config
  user: AuthUser | null
  checkAccess: (
    fn: AccessFunction | ConstraintAccessFunction | undefined,
    args: AccessArgs,
  ) => Promise<boolean>
  accessDenied: (c: Context<LontarEnv>, user: AuthUser | null) => Response
  executeUpdate: (args: {
    collection: CollectionConfig
    db: DatabaseAdapter
    id: number
    originalDoc: DocumentData
    localeOriginalDoc?: DocumentData
    data: DocumentData
    req?: Request
    draft?: boolean
    autosave?: boolean
    userId?: string | null
    config?: Config
    locale?: string
  }) => Promise<MutationExecutionResult>
}

async function processOptionalUploadFile(
  fileVal: unknown,
  collection: CollectionConfig,
  config: Config,
  id: number,
  forDraft?: boolean,
): Promise<
  { ok: true; doc?: UploadedMediaDoc } | { ok: false; error: string; status: 400 | 413 | 500 }
> {
  if (!isUploadFile(fileVal)) {
    return { ok: true }
  }
  const processed = await processIncomingFile(fileVal, collection, config, id, forDraft)
  if (!processed.ok) {
    return { ok: false, error: processed.error, status: processed.status }
  }
  return { ok: true, doc: processed.uploadDoc }
}

async function applyValidatedUpdate(args: {
  ctx: UploadUpdateContext
  originalDoc: DocumentData
  localeOriginalDoc: DocumentData
  validation: { success: true; data: DocumentData }
  newUploadDoc?: UploadedMediaDoc
  draft?: boolean
  autosave?: boolean
  userId?: string | null
  locale?: string
  fallbackLocale?: string | false
}): Promise<Response> {
  const { c, id, collection, config, user, executeUpdate } = args.ctx
  const updateData: DocumentData = {
    ...args.validation.data,
    ...(args.newUploadDoc ? args.newUploadDoc : {}),
  }

  let result: MutationExecutionResult
  try {
    result = await executeUpdate({
      collection,
      data: updateData,
      db: config.db,
      id,
      originalDoc: args.originalDoc,
      localeOriginalDoc: args.localeOriginalDoc,
      req: c.req.raw,
      draft: args.draft,
      autosave: args.autosave,
      userId: args.userId,
      config,
      locale: args.locale,
    })
  } catch (err) {
    await rollbackNewMedia(config, args.newUploadDoc)
    throw err
  }

  if (!result.success) {
    await rollbackNewMedia(config, args.newUploadDoc)
    return c.json(result.body, result.status)
  }

  const isDraftUpdate = Boolean(args.draft) || Boolean(result.isDraftRevision)
  if (!isDraftUpdate) {
    await cleanupReplacedMedia(config, args.originalDoc, args.newUploadDoc)
  }
  return respondPopulatedDoc(
    c,
    collection,
    config,
    result.doc,
    user,
    200,
    args.locale,
    args.fallbackLocale,
  )
}

// The update access function again, now with the body, and the row constraint it may return. A
// document outside the constraint is "not found" (ADR 0030 §6).
async function checkUpdateRowAccess(
  ctx: UploadUpdateContext,
  data: Record<string, unknown>,
  locale: string | undefined,
  fallbackLocale: string | false | undefined,
): Promise<Response | null> {
  const { c, id, collection, config, user, accessDenied } = ctx
  try {
    await assertRowAccess({
      config,
      collection,
      id,
      user,
      operations: ['update'],
      data,
      locale,
      fallbackLocale,
      req: c.req.raw,
    })
    return null
  } catch (err) {
    if (err instanceof AccessDeniedError) return accessDenied(c, user)
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
    throw err
  }
}

export async function handleUploadUpdate(ctx: UploadUpdateContext): Promise<Response> {
  const { c, id, collection, config, user, accessDenied } = ctx

  const localeResult = resolveUploadLocale(config, c)
  if (localeResult.errorResponse) {
    return localeResult.errorResponse
  }
  const { locale, fallbackLocale } = localeResult

  // Refuse early on a plain denial, before the body is read.
  const preliminary = await resolveAccess(
    collection,
    'update',
    { user, id, locale, req: c.req.raw },
    config,
  )
  if (!preliminary.allowed) {
    return accessDenied(c, user)
  }

  const rawBody = (await c.req.parseBody()) as Record<string, unknown>
  const rowDenied = await checkUpdateRowAccess(ctx, rawBody, locale, fallbackLocale)
  if (rowDenied) {
    return rowDenied
  }

  const draftQuery = c.req.query('draft') === 'true'
  const autosaveQuery = c.req.query('autosave') === 'true'
  const draft = resolveDraftFlag(collection, draftQuery, autosaveQuery)
  const autosave = autosaveQuery
  const userId = user?.id

  const originalDoc = await resolveOriginalDoc(config.db, collection, id, draft)
  if (!originalDoc) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }

  const uploadResult = await processOptionalUploadFile(
    rawBody.file,
    collection,
    config,
    id,
    Boolean(draft),
  )
  if (!uploadResult.ok) {
    return c.json({ error: uploadResult.error }, uploadResult.status)
  }

  const localeOriginalDoc = await resolveLocaleOriginalDoc(
    config.db,
    collection,
    id,
    originalDoc,
    config,
    locale,
  )
  const locales = extractLocaleCodes(config)
  const schema = clientFieldsToZod(toClientCollection(collection).fields, {
    partial: true,
    originalDoc: localeOriginalDoc,
    locale,
    locales,
  })
  const validation = await parseAndValidateFields(rawBody, collection, schema, {
    operation: 'update',
    originalDoc: localeOriginalDoc,
    req: c.req.raw,
    draft: Boolean(draft),
    user,
    locale,
  })
  if (!validation.success) {
    await rollbackNewMedia(config, uploadResult.doc)
    return c.json({ error: 'Validation failed', issues: validation.issues }, 400)
  }

  return applyValidatedUpdate({
    ctx,
    originalDoc,
    localeOriginalDoc,
    validation,
    newUploadDoc: uploadResult.doc,
    draft,
    autosave,
    userId,
    locale,
    fallbackLocale,
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

function isInvalidFilename(filename: string | undefined): boolean {
  if (!filename) return true
  return filename.includes('\0') || filename.includes('..')
}

interface ReadAccessResult {
  denied?: Response
  /** Set when read access returned a constraint (ADR 0030). */
  constraint?: Where
}

async function checkCollectionReadAccess(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
): Promise<ReadAccessResult> {
  const user = c.get('user') ?? null
  const decision = await resolveAccess(collection, 'read', { user }, config)
  if (!decision.allowed) return { denied: accessDenied(c, user) }
  return { constraint: decision.constraint }
}

const VARIANT_CANDIDATE_LIMIT = 25

// Resized files are named `<original base>-<size>.<ext>`, so a request for one can name a document
// whose `filename` is different. Look for documents that could own the file, under the constraint,
// and confirm the owner by comparing the stored names exactly.
async function ownsServedFile(
  config: Config,
  collection: CollectionConfig,
  filename: string,
  constraint: Where,
): Promise<boolean> {
  const lastDot = filename.lastIndexOf('.')
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename
  const lastDash = stem.lastIndexOf('-')
  const names: Where[] = [{ filename: { equals: filename } }]
  if (lastDash > 0) names.push({ filename: { contains: stem.slice(0, lastDash) } })

  const result = await config.db.find({
    collection,
    where: { and: [{ or: names }, constraint] },
    page: 1,
    limit: VARIANT_CANDIDATE_LIMIT,
  })
  return result.docs.some((doc) => {
    if (doc.filename === filename) return true
    const sizes = doc.sizes
    if (!sizes || typeof sizes !== 'object') return false
    return Object.values(sizes as Record<string, unknown>).some(
      (size) => (size as { filename?: unknown } | null)?.filename === filename,
    )
  })
}

async function resolveMimeAndDisposition(
  buffer: Buffer,
  filename: string,
): Promise<{ mimeType: string; contentDisposition: string }> {
  const sniffed = await fileTypeFromBuffer(buffer)
  const mimeType = sniffed?.mime ?? 'application/octet-stream'
  const isImage = mimeType.toLowerCase().startsWith('image/')
  const baseFilename = filename.split('/').filter(Boolean).pop() ?? filename
  const contentDisposition = isImage ? 'inline' : `attachment; filename="${baseFilename}"`
  return { mimeType, contentDisposition }
}

interface FileHeadersArgs {
  mimeType: string
  contentDisposition: string
  length: number
  constrained: boolean
}

function fileHeaders(args: FileHeadersArgs): Record<string, string> {
  return {
    'Content-Type': args.mimeType,
    'Content-Disposition': args.contentDisposition,
    'Content-Length': String(args.length),
    // A shared cache must not hand a constrained file to someone outside the constraint.
    'Cache-Control': args.constrained
      ? 'private, max-age=0, must-revalidate'
      : 'public, max-age=31536000, immutable',
  }
}

export async function handleServeFile(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
): Promise<Response> {
  if (!collection.upload) {
    return c.json({ error: 'Collection does not support uploads' }, 404)
  }

  const { denied, constraint } = await checkCollectionReadAccess(c, collection, config)
  if (denied) {
    return denied
  }

  const storage = config.storage
  if (!storage || typeof storage.read !== 'function') {
    return c.json({ error: 'File serving is not supported by current storage adapter' }, 404)
  }

  const rawFilename = c.req.param('filename')
  if (!rawFilename || isInvalidFilename(rawFilename)) {
    return c.json({ error: 'Invalid filename' }, 400)
  }

  // A file outside the constraint is "not found", like one that does not exist (ADR 0030 §6).
  const constrained = constraint !== undefined
  if (constraint && !(await ownsServedFile(config, collection, rawFilename, constraint))) {
    return c.json({ error: 'File not found' }, 404)
  }

  const buffer = await storage.read(rawFilename)
  if (!buffer) {
    return c.json({ error: 'File not found' }, 404)
  }

  const { mimeType, contentDisposition } = await resolveMimeAndDisposition(buffer, rawFilename)

  return new Response(buffer as never, {
    status: 200,
    headers: fileHeaders({ mimeType, contentDisposition, length: buffer.length, constrained }),
  })
}
