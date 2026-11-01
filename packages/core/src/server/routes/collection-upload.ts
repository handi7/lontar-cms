import type { Context } from 'hono'
import type { z } from 'zod'
import type { AuthUser, LontarVariables } from '../../auth/types'
import type { AccessArgs, AccessFunction, CollectionConfig, Config } from '../../config/types'
import type { DatabaseAdapter, DocumentData } from '../../database/adapter'
import type { Field } from '../../fields/types'
import { parseDepth, populateDoc } from '../../populate'
import { deleteMedia, uploadMedia, type UploadedMediaDoc } from '../../storage'

type LontarEnv = { Variables: LontarVariables }

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

function matchesMimeType(actual: string, pattern: string): boolean {
  if (pattern === '*/*') return true
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1)
    return actual.startsWith(prefix)
  }
  return actual.toLowerCase() === pattern.toLowerCase()
}

export function isAllowedMimeType(mimeType: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true
  return allowed.some((pattern) => matchesMimeType(mimeType, pattern))
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
  { ok: true; uploadDoc: UploadedMediaDoc } | { ok: false; error: string; status: 400 | 500 }

async function processIncomingFile(
  file: File,
  collection: CollectionConfig,
  config: Config,
): Promise<ProcessFileResult> {
  if (!config.storage) {
    return { ok: false, error: 'Storage adapter is not configured', status: 500 }
  }
  const uploadConfig = typeof collection.upload === 'object' ? collection.upload : undefined
  const mimeType = file.type || 'application/octet-stream'
  if (!isAllowedMimeType(mimeType, uploadConfig?.mimeTypes)) {
    return { ok: false, error: `File type "${mimeType}" is not allowed`, status: 400 }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = file.name || 'unnamed'
  const uploadDoc = await uploadMedia({
    storage: config.storage,
    file: { filename, buffer, mimeType },
    uploadConfig: collection.upload,
  })
  return { ok: true, uploadDoc }
}

async function cleanupReplacedMedia(
  config: Config,
  originalDoc: DocumentData,
  newUploadDoc?: UploadedMediaDoc,
): Promise<void> {
  if (newUploadDoc && typeof originalDoc.filename === 'string') {
    await safeDeleteMedia(config, {
      filename: originalDoc.filename,
      sizes: originalDoc.sizes,
    })
  }
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

export async function handleUploadUpdate(ctx: UploadUpdateContext): Promise<Response> {
  const {
    c,
    id,
    collection,
    config,
    partialSchema,
    user,
    checkAccess,
    accessDenied,
    executeUpdate,
  } = ctx

  const rawBody = (await c.req.parseBody()) as Record<string, unknown>
  const allowed = await checkAccess(collection.access?.update, { user, id, data: rawBody })
  if (!allowed) {
    return accessDenied(c, user)
  }

  const originalDoc = await config.db.findByID({ collection, id })
  if (!originalDoc) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }

  let newUploadDoc: UploadedMediaDoc | undefined
  if (isUploadFile(rawBody.file)) {
    const processed = await processIncomingFile(rawBody.file, collection, config)
    if (!processed.ok) {
      return c.json({ error: processed.error }, processed.status)
    }
    newUploadDoc = processed.uploadDoc
  }

  const validation = parseAndValidateFields(rawBody, collection, partialSchema)
  if (!validation.success) {
    await rollbackNewMedia(config, newUploadDoc)
    return c.json({ error: 'Validation failed', issues: validation.issues }, 400)
  }

  const updateData: DocumentData = {
    ...validation.data,
    ...(newUploadDoc ?? {}),
  }

  const result = await executeUpdate({
    collection,
    data: updateData,
    db: config.db,
    id,
    originalDoc,
    req: c.req.raw,
  })

  if (!result.doc) {
    await rollbackNewMedia(config, newUploadDoc)
    return c.json({ error: result.error ?? 'Update operation failed' }, 400)
  }

  await cleanupReplacedMedia(config, originalDoc, newUploadDoc)
  return respondPopulatedDoc(c, collection, config, result.doc, user, 200)
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
