import type { AuthUser } from '../auth/types'
import type { DocumentData } from '../database/adapter'
import type { Block, Field, FieldAccessArgs, FieldAccessFunction } from '../fields/types'

export type FieldAccessCache = Map<FieldAccessFunction, Map<string | null, boolean>>

export const requestFieldAccessCache = new WeakMap<Request, FieldAccessCache>()

export function createFieldAccessCache(): FieldAccessCache {
  return new Map()
}

export function getFieldAccessCache(req?: Request): FieldAccessCache {
  if (!req) return createFieldAccessCache()
  let cache = requestFieldAccessCache.get(req)
  if (!cache) {
    cache = createFieldAccessCache()
    requestFieldAccessCache.set(req, cache)
  }
  return cache
}

function resolveUserKey(user: AuthUser | null, locale?: string): string | null {
  const base = user ? `${user.id ?? ''}:${user.role ?? ''}` : 'anonymous'
  return locale ? `${base}:${locale}` : base
}

function getCachedFieldAccess(
  cache: FieldAccessCache | undefined,
  fn: FieldAccessFunction,
  userKey: string | null,
): boolean | undefined {
  if (!cache) return undefined
  const fnCache = cache.get(fn)
  if (fnCache?.has(userKey)) {
    return fnCache.get(userKey)
  }
  return undefined
}

function storeCachedFieldAccess(
  cache: FieldAccessCache,
  fn: FieldAccessFunction,
  userKey: string | null,
  result: boolean,
): void {
  let fnCache = cache.get(fn)
  if (!fnCache) {
    fnCache = new Map()
    cache.set(fn, fnCache)
  }
  fnCache.set(userKey, result)
}

export interface CheckFieldAccessOptions {
  /**
   * Deny when the access function reads `id`, `data`, `siblingData` or `doc`. Used for
   * collection-wide checks (query filters and sorts) where there is no single document to
   * evaluate, so a document-dependent rule cannot be answered honestly.
   */
  denyOnDocumentAccess?: boolean
}

export async function checkFieldAccess(
  fn: FieldAccessFunction | undefined,
  args: FieldAccessArgs,
  cache?: FieldAccessCache,
  options?: CheckFieldAccessOptions,
): Promise<boolean> {
  if (!fn) return true

  const effectiveCache = cache ?? (args.req ? getFieldAccessCache(args.req) : undefined)
  const userKey = resolveUserKey(args.user, args.locale)
  const cached = getCachedFieldAccess(effectiveCache, fn, userKey)
  if (cached !== undefined) {
    return cached
  }

  let documentAccessed = false
  const proxyArgs: FieldAccessArgs = {
    user: args.user,
    req: args.req,
    locale: args.locale,
    get id() {
      documentAccessed = true
      return args.id
    },
    get data() {
      documentAccessed = true
      return args.data
    },
    get siblingData() {
      documentAccessed = true
      return args.siblingData
    },
    get doc() {
      documentAccessed = true
      return args.doc
    },
  }

  try {
    const result = Boolean(await fn(proxyArgs))
    if (documentAccessed) return !options?.denyOnDocumentAccess && result
    if (effectiveCache) storeCachedFieldAccess(effectiveCache, fn, userKey, result)
    return result
  } catch (err) {
    console.warn('[lontar:access] Field access check threw an error:', err)
    return false
  }
}

// -----------------------------------------------------------------------------
// Read Sanitization
// -----------------------------------------------------------------------------

export interface ReadSanitizationContext {
  id?: string | number
  doc?: DocumentData
  cache?: FieldAccessCache
  req?: Request
  locale?: string
}

async function checkReadPermission(
  field: Field,
  user: AuthUser | null,
  siblingData: DocumentData,
  rootDoc: DocumentData,
  targetId?: string | number,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<boolean> {
  return checkFieldAccess(
    field.access?.read,
    {
      user,
      id: targetId ?? (rootDoc.id as string | number | undefined),
      data: rootDoc,
      siblingData,
      doc: rootDoc,
      req,
      locale,
    },
    cache,
  )
}

async function sanitizeFieldsRead(
  fields: Record<string, Field>,
  data: DocumentData,
  user: AuthUser | null,
  rootDoc: DocumentData,
  targetId?: string | number,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<DocumentData> {
  const result: DocumentData = { ...data }
  for (const [name, field] of Object.entries(fields)) {
    const allowed = await checkReadPermission(
      field,
      user,
      data,
      rootDoc,
      targetId,
      cache,
      req,
      locale,
    )
    if (!allowed) {
      delete result[name]
      continue
    }
    result[name] = await sanitizeNestedRead(
      field,
      result[name],
      user,
      rootDoc,
      targetId,
      cache,
      req,
      locale,
    )
  }
  return result
}

async function sanitizeNestedRead(
  field: Field,
  value: unknown,
  user: AuthUser | null,
  rootDoc: DocumentData,
  targetId?: string | number,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<unknown> {
  if (value === undefined || value === null) return value

  if (field.type === 'group' && typeof value === 'object') {
    return sanitizeFieldsRead(
      field.fields,
      value as Record<string, unknown>,
      user,
      rootDoc,
      targetId,
      cache,
      req,
      locale,
    )
  }
  if (field.type === 'array' && Array.isArray(value)) {
    return sanitizeArrayRead(field.fields, value, user, rootDoc, targetId, cache, req, locale)
  }
  if (field.type === 'blocks' && Array.isArray(value)) {
    return sanitizeBlocksRead(field.blocks, value, user, rootDoc, targetId, cache, req, locale)
  }
  return value
}

async function sanitizeArrayRowRead(
  fields: Record<string, Field>,
  item: unknown,
  user: AuthUser | null,
  rootDoc: DocumentData,
  targetId?: string | number,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<unknown> {
  if (typeof item !== 'object' || item === null) return item
  const row = item as Record<string, unknown>
  return sanitizeFieldsRead(fields, row, user, rootDoc, targetId, cache, req, locale)
}

async function sanitizeArrayRead(
  fields: Record<string, Field>,
  items: unknown[],
  user: AuthUser | null,
  rootDoc: DocumentData,
  targetId?: string | number,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<unknown[]> {
  const result: unknown[] = []
  for (const item of items) {
    result.push(
      await sanitizeArrayRowRead(fields, item, user, rootDoc, targetId, cache, req, locale),
    )
  }
  return result
}

async function sanitizeBlockRowRead(
  blocks: readonly Block[],
  item: unknown,
  user: AuthUser | null,
  rootDoc: DocumentData,
  targetId?: string | number,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<unknown> {
  if (typeof item !== 'object' || item === null) return item
  const block = item as Record<string, unknown>
  const blockDef = blocks.find((b) => b.slug === block.blockType)
  if (!blockDef) return block
  return sanitizeFieldsRead(blockDef.fields, block, user, rootDoc, targetId, cache, req, locale)
}

async function sanitizeBlocksRead(
  blocks: readonly Block[],
  items: unknown[],
  user: AuthUser | null,
  rootDoc: DocumentData,
  targetId?: string | number,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<unknown[]> {
  const result: unknown[] = []
  for (const item of items) {
    result.push(
      await sanitizeBlockRowRead(blocks, item, user, rootDoc, targetId, cache, req, locale),
    )
  }
  return result
}

function resolveReadCache(context?: ReadSanitizationContext): FieldAccessCache {
  if (context?.cache) return context.cache
  if (context?.req) return getFieldAccessCache(context.req)
  return createFieldAccessCache()
}

export async function sanitizeDocRead(
  fields: Record<string, Field>,
  doc: DocumentData,
  user: AuthUser | null,
  context?: ReadSanitizationContext,
): Promise<DocumentData> {
  if (!doc || typeof doc !== 'object') return doc
  const docId = context?.id ?? (doc.id as string | number | undefined)
  const baseDoc = context?.doc ?? doc
  const cache = resolveReadCache(context)
  return sanitizeFieldsRead(fields, doc, user, baseDoc, docId, cache, context?.req, context?.locale)
}

// -----------------------------------------------------------------------------
// Write Sanitization (Silent Drop & Preserve Locked/Hidden Subfields)
// -----------------------------------------------------------------------------

export interface WriteSanitizationContext {
  user: AuthUser | null
  id?: string | number
  data?: DocumentData
  doc?: DocumentData
  cache?: FieldAccessCache
  req?: Request
  locale?: string
}

async function checkWritePermission(
  field: Field,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  siblingData: DocumentData,
  rootData: DocumentData,
  targetId?: string | number,
): Promise<boolean> {
  const fn = operation === 'create' ? field.access?.create : field.access?.update
  return checkFieldAccess(
    fn,
    {
      user: context.user,
      id: targetId ?? context.id,
      data: rootData,
      siblingData,
      doc: context.doc,
      req: context.req,
      locale: context.locale,
    },
    context.cache,
  )
}

function buildStoredRowMap(items?: unknown[]): Map<string | number, DocumentData> {
  const map = new Map<string | number, DocumentData>()
  if (!Array.isArray(items)) return map
  for (const item of items) {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const id = record.id
      if (typeof id === 'string' || typeof id === 'number') {
        map.set(id, record)
      }
    }
  }
  return map
}

function findMatchingStoredBlock(
  block: Record<string, unknown>,
  storedById?: Map<string | number, DocumentData>,
): DocumentData | undefined {
  if (!storedById || block.id === undefined || block.id === null) return undefined
  const stored = storedById.get(block.id as string | number)
  if (stored && stored.blockType === block.blockType) {
    return stored
  }
  return undefined
}

async function mergeSubfieldWithStored(
  name: string,
  field: Field,
  incomingRow: Record<string, unknown>,
  storedRow: Record<string, unknown>,
  context: WriteSanitizationContext,
  rootData: DocumentData,
  targetId?: string | number,
): Promise<unknown> {
  const canUpdate = await checkWritePermission(
    field,
    'update',
    context,
    incomingRow,
    rootData,
    targetId,
  )
  if (!canUpdate) {
    return name in storedRow ? storedRow[name] : undefined
  }

  // A write-only subfield (update allowed, read denied) behaves like a top-level one:
  // an explicit incoming value is written, and an omitted one keeps the stored value,
  // since the client could never have seen it to send it back.
  const canRead = await checkReadPermission(
    field,
    context.user,
    storedRow,
    context.doc ?? storedRow,
    targetId,
    context.cache,
    context.req,
  )
  if (!canRead && !(name in incomingRow)) {
    return name in storedRow ? storedRow[name] : undefined
  }

  const val = incomingRow[name]
  if (val === undefined) {
    return undefined
  }

  const storedChild = storedRow[name]
  return sanitizeNestedWrite(field, val, 'update', context, rootData, storedChild, targetId)
}

async function mergeRowWithStored(
  fields: Record<string, Field>,
  incomingRow: Record<string, unknown>,
  storedRow: Record<string, unknown>,
  context: WriteSanitizationContext,
  rootData: DocumentData,
  targetId?: string | number,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...incomingRow }

  for (const [name, field] of Object.entries(fields)) {
    const merged = await mergeSubfieldWithStored(
      name,
      field,
      incomingRow,
      storedRow,
      context,
      rootData,
      targetId,
    )
    if (merged !== undefined) {
      result[name] = merged
    } else if (name in incomingRow && !(name in storedRow)) {
      delete result[name]
    }
  }

  return result
}

async function sanitizeFieldsWrite(
  fields: Record<string, Field>,
  data: DocumentData,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
  targetId?: string | number,
  storedData?: DocumentData,
): Promise<DocumentData> {
  const result: DocumentData = { ...data }
  for (const [name, field] of Object.entries(fields)) {
    if (!(name in data) || data[name] === undefined) {
      continue
    }
    const allowed = await checkWritePermission(field, operation, context, data, rootData, targetId)
    if (!allowed) {
      delete result[name]
      continue
    }
    const storedChild = storedData?.[name]
    result[name] = await sanitizeNestedWrite(
      field,
      result[name],
      operation,
      context,
      rootData,
      storedChild,
      targetId,
    )
  }
  return result
}

async function sanitizeGroupWrite(
  fields: Record<string, Field>,
  value: Record<string, unknown>,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
  storedValue?: unknown,
  targetId?: string | number,
): Promise<unknown> {
  const storedGroup =
    storedValue && typeof storedValue === 'object' && !Array.isArray(storedValue)
      ? (storedValue as Record<string, unknown>)
      : undefined
  if (operation === 'update' && storedGroup) {
    return mergeRowWithStored(fields, value, storedGroup, context, rootData, targetId)
  }
  return sanitizeFieldsWrite(fields, value, operation, context, rootData, targetId)
}

async function sanitizeNestedWrite(
  field: Field,
  value: unknown,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
  storedValue?: unknown,
  targetId?: string | number,
): Promise<unknown> {
  if (value === null || typeof value !== 'object') return value

  if (field.type === 'group') {
    return sanitizeGroupWrite(
      field.fields,
      value as Record<string, unknown>,
      operation,
      context,
      rootData,
      storedValue,
      targetId,
    )
  }
  if (field.type === 'array' && Array.isArray(value)) {
    const storedArray = Array.isArray(storedValue) ? storedValue : undefined
    return sanitizeArrayWrite(
      field.fields,
      value,
      operation,
      context,
      rootData,
      storedArray,
      targetId,
    )
  }
  if (field.type === 'blocks' && Array.isArray(value)) {
    const storedBlocks = Array.isArray(storedValue) ? storedValue : undefined
    return sanitizeBlocksWrite(
      field.blocks,
      value,
      operation,
      context,
      rootData,
      storedBlocks,
      targetId,
    )
  }
  return value
}

async function sanitizeArrayRowWrite(
  fields: Record<string, Field>,
  item: unknown,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
  storedById?: Map<string | number, DocumentData>,
  targetId?: string | number,
): Promise<unknown> {
  if (typeof item !== 'object' || item === null) return item
  const row = item as Record<string, unknown>
  const storedRow =
    storedById && row.id !== undefined && row.id !== null
      ? storedById.get(row.id as string | number)
      : undefined

  if (storedRow) {
    return mergeRowWithStored(fields, row, storedRow, context, rootData, targetId)
  }
  return sanitizeFieldsWrite(fields, row, operation, context, rootData, targetId)
}

async function sanitizeArrayWrite(
  fields: Record<string, Field>,
  items: unknown[],
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
  storedItems?: unknown[],
  targetId?: string | number,
): Promise<unknown[]> {
  const storedById = operation === 'update' ? buildStoredRowMap(storedItems) : undefined
  const result: unknown[] = []
  for (const item of items) {
    result.push(
      await sanitizeArrayRowWrite(fields, item, operation, context, rootData, storedById, targetId),
    )
  }
  return result
}

async function sanitizeBlockRowWrite(
  blocks: readonly Block[],
  item: unknown,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
  storedById?: Map<string | number, DocumentData>,
  targetId?: string | number,
): Promise<unknown> {
  if (typeof item !== 'object' || item === null) return item
  const block = item as Record<string, unknown>
  const blockDef = blocks.find((b) => b.slug === block.blockType)
  if (!blockDef) return block

  const storedBlock = findMatchingStoredBlock(block, storedById)
  if (storedBlock) {
    return mergeRowWithStored(blockDef.fields, block, storedBlock, context, rootData, targetId)
  }
  return sanitizeFieldsWrite(blockDef.fields, block, operation, context, rootData, targetId)
}

async function sanitizeBlocksWrite(
  blocks: readonly Block[],
  items: unknown[],
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
  storedItems?: unknown[],
  targetId?: string | number,
): Promise<unknown[]> {
  const storedById = operation === 'update' ? buildStoredRowMap(storedItems) : undefined
  const result: unknown[] = []
  for (const item of items) {
    result.push(
      await sanitizeBlockRowWrite(blocks, item, operation, context, rootData, storedById, targetId),
    )
  }
  return result
}

export async function sanitizeDocWrite(
  fields: Record<string, Field>,
  data: DocumentData,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
): Promise<DocumentData> {
  if (!data || typeof data !== 'object') return data
  const cache =
    context.cache ?? (context.req ? getFieldAccessCache(context.req) : createFieldAccessCache())
  const resolvedContext: WriteSanitizationContext = { ...context, cache }
  const rootData = resolvedContext.data ?? data
  const storedData = operation === 'update' ? resolvedContext.doc : undefined
  return sanitizeFieldsWrite(
    fields,
    data,
    operation,
    resolvedContext,
    rootData,
    resolvedContext.id,
    storedData,
  )
}
