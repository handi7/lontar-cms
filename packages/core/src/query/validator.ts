import type { CollectionConfig } from '../config/types'
import { SYSTEM_FIELDS, UPLOAD_SYSTEM_FIELDS } from '../client/system-fields'
import { KNOWN_OPERATORS } from './parser'
import type { Where } from './types'

export interface QueryValidationIssue {
  path: string
  message: string
}

export function getAllowedFields(collection: CollectionConfig): Set<string> {
  const allowed = new Set<string>(SYSTEM_FIELDS)
  if (collection.upload) {
    for (const f of UPLOAD_SYSTEM_FIELDS) {
      allowed.add(f)
    }
  }
  for (const f of Object.keys(collection.fields)) {
    allowed.add(f)
  }
  return allowed
}

function validateFieldFilter(
  fieldPath: string,
  filter: unknown,
  issues: QueryValidationIssue[],
): void {
  if (filter === null || typeof filter !== 'object' || filter instanceof Date) {
    return
  }
  if (Array.isArray(filter)) {
    return
  }

  for (const [op] of Object.entries(filter)) {
    if (!KNOWN_OPERATORS.has(op)) {
      issues.push({
        path: `${fieldPath}.${op}`,
        message: `Unknown operator "${op}"`,
      })
    }
  }
}

function validateLogicalGroup(
  groupPath: string,
  items: unknown,
  allowed: Set<string>,
  issues: QueryValidationIssue[],
): void {
  if (!Array.isArray(items)) {
    issues.push({
      path: groupPath,
      message: `Expected array for "${groupPath}" condition`,
    })
    return
  }

  const list: readonly unknown[] = items
  for (let i = 0; i < list.length; i++) {
    const item: unknown = list[i]
    const itemPath = `${groupPath}[${i}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({
        path: itemPath,
        message: 'Expected object in logical condition list',
      })
      continue
    }
    validateWhereNode(item as Where, allowed, itemPath, issues)
  }
}

function validateWhereNode(
  where: Where,
  allowed: Set<string>,
  currentPath: string,
  issues: QueryValidationIssue[],
): void {
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue
    const fieldPath = currentPath ? `${currentPath}.${key}` : key

    if (key === 'and' || key === 'or') {
      validateLogicalGroup(fieldPath, val, allowed, issues)
      continue
    }

    if (!allowed.has(key)) {
      issues.push({
        path: fieldPath,
        message: `Unknown field "${key}"`,
      })
      continue
    }

    validateFieldFilter(fieldPath, val, issues)
  }
}

export function validateWhere(
  where: Where | undefined,
  collection: CollectionConfig,
): QueryValidationIssue[] {
  if (!where || typeof where !== 'object') {
    return []
  }
  const allowed = getAllowedFields(collection)
  const issues: QueryValidationIssue[] = []
  validateWhereNode(where, allowed, '', issues)
  return issues
}
