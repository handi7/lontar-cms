import type { AuthUser } from '../auth/types'
import {
  BASE_SYSTEM_FIELDS,
  DRAFT_SYSTEM_FIELDS,
  UPLOAD_SYSTEM_FIELDS,
} from '../client/system-fields'
import type { CollectionConfig } from '../config/types'
import type { Block, Field } from '../fields/types'
import { flattenFields } from '../fields/flatten'
import { parseSort } from '../query/parser'
import type { QueryValidationIssue } from '../query/validator'
import { getGroupFields } from '../query/validator'
import type { SortItem, Where } from '../query/types'
import { checkFieldAccess, getFieldAccessCache, type FieldAccessCache } from './field-access'

export interface QueryAccessOptions {
  cache?: FieldAccessCache
  req?: Request
}

const SYSTEM_FIELDS = new Set<string>([
  ...BASE_SYSTEM_FIELDS,
  ...DRAFT_SYSTEM_FIELDS,
  ...UPLOAD_SYSTEM_FIELDS,
])

function isSystemPath(fieldPath: string): boolean {
  return SYSTEM_FIELDS.has(fieldPath)
}

function normalizeSort(sort: string | string[] | SortItem[] | undefined): SortItem[] {
  if (!sort) return []
  if (Array.isArray(sort)) {
    if (sort.length > 0 && typeof sort[0] === 'object' && 'field' in sort[0]) {
      return sort as SortItem[]
    }
    return parseSort(sort as string[])
  }
  return parseSort(sort)
}

function collectLogicalPaths(
  val: unknown,
  groupFields: Set<string>,
  currentPath: string,
  paths: Set<string>,
): void {
  if (!Array.isArray(val)) return
  for (const item of val) {
    if (item && typeof item === 'object') {
      collectWhereNodePaths(item as Where, groupFields, currentPath, paths)
    }
  }
}

function collectWhereEntryPath(
  key: string,
  val: unknown,
  groupFields: Set<string>,
  currentPath: string,
  paths: Set<string>,
): void {
  if (key === 'and' || key === 'or') {
    collectLogicalPaths(val, groupFields, currentPath, paths)
    return
  }
  const fieldPath = currentPath ? `${currentPath}.${key}` : key
  if (
    groupFields.has(fieldPath) &&
    val !== null &&
    typeof val === 'object' &&
    !Array.isArray(val)
  ) {
    collectWhereNodePaths(val as Where, groupFields, fieldPath, paths)
    return
  }
  paths.add(fieldPath)
}

function collectWhereNodePaths(
  where: Where,
  groupFields: Set<string>,
  currentPath: string,
  paths: Set<string>,
): void {
  for (const [key, val] of Object.entries(where)) {
    if (val !== undefined) {
      collectWhereEntryPath(key, val, groupFields, currentPath, paths)
    }
  }
}

export function extractReferencedPaths(
  where: Where | undefined,
  sort: string | string[] | SortItem[] | undefined,
  collection: CollectionConfig,
): string[] {
  const paths = new Set<string>()
  if (where && typeof where === 'object') {
    const groupFields = getGroupFields(collection)
    collectWhereNodePaths(where, groupFields, '', paths)
  }
  for (const item of normalizeSort(sort)) {
    if (item.field) {
      paths.add(item.field)
    }
  }
  return Array.from(paths)
}

async function checkFieldRead(
  field: Field,
  user: AuthUser | null,
  cache?: FieldAccessCache,
  req?: Request,
): Promise<boolean> {
  // There is no document here, so a read rule that depends on one is denied rather than guessed.
  return checkFieldAccess(field.access?.read, { user, req }, cache, {
    denyOnDocumentAccess: true,
  })
}

async function checkBlocksFieldAccess(
  blocks: readonly Block[],
  segments: string[],
  user: AuthUser | null,
  cache?: FieldAccessCache,
  req?: Request,
): Promise<boolean> {
  const first = segments[0]
  if (!first || first === 'id' || first === 'blockType') return true
  const rest = segments.slice(1)

  const matchingBlock = blocks.find((b) => b.slug === first)
  if (matchingBlock) {
    return checkFieldPathAccess(matchingBlock.fields, rest, user, cache, req)
  }

  for (const block of blocks) {
    if (first in block.fields || findLocaleSuffixedField(block.fields, first)) {
      const allowed = await checkFieldPathAccess(block.fields, segments, user, cache, req)
      if (!allowed) return false
    }
  }
  return true
}

/**
 * A localized field is queried as `<name>_<locale>` (for example `secretNote_en`), which is not a
 * key in `fields`. Resolve it to the base field so its access rule still applies.
 */
function findLocaleSuffixedField(fields: Record<string, Field>, name: string): Field | undefined {
  for (let i = name.indexOf('_', 1); i !== -1; i = name.indexOf('_', i + 1)) {
    const base = fields[name.slice(0, i)]
    if (base) return base
  }
  return undefined
}

async function checkFieldPathAccess(
  fields: Record<string, Field>,
  segments: string[],
  user: AuthUser | null,
  cache?: FieldAccessCache,
  req?: Request,
): Promise<boolean> {
  const name = segments[0]
  if (!name || name === 'id' || name === 'blockType') return true

  const field = fields[name] ?? findLocaleSuffixedField(fields, name)
  if (!field) return true

  const allowed = await checkFieldRead(field, user, cache, req)
  if (!allowed) return false
  return checkNestedFieldAccess(field, segments.slice(1), user, cache, req)
}

async function checkNestedFieldAccess(
  field: Field,
  rest: string[],
  user: AuthUser | null,
  cache?: FieldAccessCache,
  req?: Request,
): Promise<boolean> {
  if (rest.length === 0) return true
  if (field.type === 'group' || field.type === 'array') {
    return checkFieldPathAccess(field.fields, rest, user, cache, req)
  }
  if (field.type === 'blocks') {
    return checkBlocksFieldAccess(field.blocks, rest, user, cache, req)
  }
  return true
}

export async function isPathReadable(
  path: string,
  collection: CollectionConfig,
  user: AuthUser | null,
  cache?: FieldAccessCache,
  req?: Request,
): Promise<boolean> {
  if (isSystemPath(path)) return true
  const normalized = path.replaceAll('__', '.')
  const segments = normalized.split('.')
  return checkFieldPathAccess(flattenFields(collection.fields), segments, user, cache, req)
}

export async function validateQueryAccess(
  where: Where | undefined,
  sort: string | string[] | SortItem[] | undefined,
  collection: CollectionConfig,
  user: AuthUser | null,
  options?: QueryAccessOptions,
): Promise<QueryValidationIssue[]> {
  const paths = extractReferencedPaths(where, sort, collection)
  const issues: QueryValidationIssue[] = []
  const cache = options?.cache ?? (options?.req ? getFieldAccessCache(options.req) : undefined)

  for (const path of paths) {
    const readable = await isPathReadable(path, collection, user, cache, options?.req)
    if (!readable) {
      issues.push({
        path,
        message: `Field '${path}' cannot be filtered or sorted by current user`,
      })
    }
  }

  return issues
}
