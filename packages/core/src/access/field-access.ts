import type { AuthUser } from '../auth/types'
import type { DocumentData } from '../database/adapter'
import type { Block, Field, FieldAccessArgs, FieldAccessFunction } from '../fields/types'

const memoizedUserResults = new WeakMap<FieldAccessFunction, Map<string | null, boolean>>()

function resolveUserKey(user: AuthUser | null): string | null {
  if (!user) return null
  return `${user.id ?? ''}:${user.role ?? ''}`
}

export async function checkFieldAccess(
  fn: FieldAccessFunction | undefined,
  args: FieldAccessArgs,
): Promise<boolean> {
  if (!fn) return true

  const userKey = resolveUserKey(args.user)
  const userCache = memoizedUserResults.get(fn)
  if (userCache?.has(userKey)) {
    return userCache.get(userKey)!
  }

  let documentAccessed = false
  const proxyArgs: FieldAccessArgs = {
    user: args.user,
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
    if (!documentAccessed) {
      let cache = memoizedUserResults.get(fn)
      if (!cache) {
        cache = new Map()
        memoizedUserResults.set(fn, cache)
      }
      cache.set(userKey, result)
    }
    return result
  } catch (err) {
    console.warn('[lontar:access] Field access check threw an error:', err)
    return false
  }
}

// -----------------------------------------------------------------------------
// Read Sanitization
// -----------------------------------------------------------------------------

async function checkReadPermission(
  field: Field,
  user: AuthUser | null,
  siblingData: DocumentData,
  rootDoc: DocumentData,
  targetId?: string | number,
): Promise<boolean> {
  return checkFieldAccess(field.access?.read, {
    user,
    id: targetId ?? (rootDoc.id as string | number | undefined),
    data: rootDoc,
    siblingData,
    doc: rootDoc,
  })
}

async function sanitizeFieldsRead(
  fields: Record<string, Field>,
  data: DocumentData,
  user: AuthUser | null,
  rootDoc: DocumentData,
  targetId?: string | number,
): Promise<DocumentData> {
  const result: DocumentData = { ...data }
  for (const [name, field] of Object.entries(fields)) {
    const allowed = await checkReadPermission(field, user, data, rootDoc, targetId)
    if (!allowed) {
      delete result[name]
      continue
    }
    result[name] = await sanitizeNestedRead(field, result[name], user, rootDoc)
  }
  return result
}

async function sanitizeNestedRead(
  field: Field,
  value: unknown,
  user: AuthUser | null,
  rootDoc: DocumentData,
): Promise<unknown> {
  if (value === undefined || value === null) return value

  if (field.type === 'group' && typeof value === 'object') {
    return sanitizeFieldsRead(field.fields, value as Record<string, unknown>, user, rootDoc)
  }
  if (field.type === 'array' && Array.isArray(value)) {
    return sanitizeArrayRead(field.fields, value, user, rootDoc)
  }
  if (field.type === 'blocks' && Array.isArray(value)) {
    return sanitizeBlocksRead(field.blocks, value, user, rootDoc)
  }
  return value
}

async function sanitizeArrayRowRead(
  fields: Record<string, Field>,
  item: unknown,
  user: AuthUser | null,
  rootDoc: DocumentData,
): Promise<unknown> {
  if (typeof item !== 'object' || item === null) return item
  const row = item as Record<string, unknown>
  const rowId =
    (row.id as string | number | undefined) ?? (rootDoc.id as string | number | undefined)
  return sanitizeFieldsRead(fields, row, user, rootDoc, rowId)
}

async function sanitizeArrayRead(
  fields: Record<string, Field>,
  items: unknown[],
  user: AuthUser | null,
  rootDoc: DocumentData,
): Promise<unknown[]> {
  const result: unknown[] = []
  for (const item of items) {
    result.push(await sanitizeArrayRowRead(fields, item, user, rootDoc))
  }
  return result
}

async function sanitizeBlockRowRead(
  blocks: readonly Block[],
  item: unknown,
  user: AuthUser | null,
  rootDoc: DocumentData,
): Promise<unknown> {
  if (typeof item !== 'object' || item === null) return item
  const block = item as Record<string, unknown>
  const blockDef = blocks.find((b) => b.slug === block.blockType)
  if (!blockDef) return block
  const blockId =
    (block.id as string | number | undefined) ?? (rootDoc.id as string | number | undefined)
  return sanitizeFieldsRead(blockDef.fields, block, user, rootDoc, blockId)
}

async function sanitizeBlocksRead(
  blocks: readonly Block[],
  items: unknown[],
  user: AuthUser | null,
  rootDoc: DocumentData,
): Promise<unknown[]> {
  const result: unknown[] = []
  for (const item of items) {
    result.push(await sanitizeBlockRowRead(blocks, item, user, rootDoc))
  }
  return result
}

export async function sanitizeDocRead(
  fields: Record<string, Field>,
  doc: DocumentData,
  user: AuthUser | null,
  context?: { id?: string | number; doc?: DocumentData },
): Promise<DocumentData> {
  if (!doc || typeof doc !== 'object') return doc
  const docId = context?.id ?? (doc.id as string | number | undefined)
  const baseDoc = context?.doc ?? doc
  return sanitizeFieldsRead(fields, doc, user, baseDoc, docId)
}

// -----------------------------------------------------------------------------
// Write Sanitization (Silent Drop)
// -----------------------------------------------------------------------------

export interface WriteSanitizationContext {
  user: AuthUser | null
  id?: string | number
  data?: DocumentData
  doc?: DocumentData
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
  return checkFieldAccess(fn, {
    user: context.user,
    id: targetId ?? context.id,
    data: rootData,
    siblingData,
    doc: context.doc,
  })
}

async function sanitizeFieldsWrite(
  fields: Record<string, Field>,
  data: DocumentData,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
  targetId?: string | number,
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
    result[name] = await sanitizeNestedWrite(field, result[name], operation, context, rootData)
  }
  return result
}

async function sanitizeNestedWrite(
  field: Field,
  value: unknown,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
): Promise<unknown> {
  if (value === null || typeof value !== 'object') return value

  if (field.type === 'group') {
    return sanitizeFieldsWrite(
      field.fields,
      value as Record<string, unknown>,
      operation,
      context,
      rootData,
    )
  }
  if (field.type === 'array' && Array.isArray(value)) {
    return sanitizeArrayWrite(field.fields, value, operation, context, rootData)
  }
  if (field.type === 'blocks' && Array.isArray(value)) {
    return sanitizeBlocksWrite(field.blocks, value, operation, context, rootData)
  }
  return value
}

async function sanitizeArrayRowWrite(
  fields: Record<string, Field>,
  item: unknown,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
): Promise<unknown> {
  if (typeof item !== 'object' || item === null) return item
  const row = item as Record<string, unknown>
  const rowId = (row.id as string | number | undefined) ?? context.id
  return sanitizeFieldsWrite(fields, row, operation, context, rootData, rowId)
}

async function sanitizeArrayWrite(
  fields: Record<string, Field>,
  items: unknown[],
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
): Promise<unknown[]> {
  const result: unknown[] = []
  for (const item of items) {
    result.push(await sanitizeArrayRowWrite(fields, item, operation, context, rootData))
  }
  return result
}

async function sanitizeBlockRowWrite(
  blocks: readonly Block[],
  item: unknown,
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
): Promise<unknown> {
  if (typeof item !== 'object' || item === null) return item
  const block = item as Record<string, unknown>
  const blockDef = blocks.find((b) => b.slug === block.blockType)
  if (!blockDef) return block
  const blockId = (block.id as string | number | undefined) ?? context.id
  return sanitizeFieldsWrite(blockDef.fields, block, operation, context, rootData, blockId)
}

async function sanitizeBlocksWrite(
  blocks: readonly Block[],
  items: unknown[],
  operation: 'create' | 'update',
  context: WriteSanitizationContext,
  rootData: DocumentData,
): Promise<unknown[]> {
  const result: unknown[] = []
  for (const item of items) {
    result.push(await sanitizeBlockRowWrite(blocks, item, operation, context, rootData))
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
  const rootData = context.data ?? data
  return sanitizeFieldsWrite(fields, data, operation, context, rootData)
}
