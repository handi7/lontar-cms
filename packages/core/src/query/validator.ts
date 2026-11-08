import type { CollectionConfig } from '../config/types'
import type { Field } from '../fields/types'
import { SYSTEM_FIELDS, UPLOAD_SYSTEM_FIELDS } from '../client/system-fields'
import { KNOWN_OPERATORS } from './parser'
import type { Where } from './types'

export interface QueryValidationIssue {
  path: string
  message: string
}

function addFieldToAllowed(allowed: Set<string>, name: string, field: Field): void {
  allowed.add(name)
  if (field.type === 'group') {
    for (const [subName, subField] of Object.entries(field.fields)) {
      addFieldToAllowed(allowed, `${name}.${subName}`, subField)
      addFieldToAllowed(allowed, `${name}__${subName}`, subField)
    }
  }
}

function collectGroupPaths(groups: Set<string>, name: string, field: Field, prefix = ''): void {
  const current = prefix ? `${prefix}.${name}` : name
  if (field.type === 'group') {
    groups.add(current)
    groups.add(prefix ? `${prefix}__${name}` : name)
    for (const [subName, subField] of Object.entries(field.fields)) {
      collectGroupPaths(groups, subName, subField, current)
    }
  }
}

export function getGroupFields(collection: CollectionConfig): Set<string> {
  const groups = new Set<string>()
  for (const [name, field] of Object.entries(collection.fields)) {
    collectGroupPaths(groups, name, field)
  }
  return groups
}

export function getAllowedFields(collection: CollectionConfig): Set<string> {
  const allowed = new Set<string>(SYSTEM_FIELDS)
  if (collection.upload) {
    for (const f of UPLOAD_SYSTEM_FIELDS) {
      allowed.add(f)
    }
  }
  for (const [name, field] of Object.entries(collection.fields)) {
    addFieldToAllowed(allowed, name, field)
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
  groupFields: Set<string>,
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
    validateWhereNode(item as Where, allowed, groupFields, itemPath, issues)
  }
}

function isNestedGroupWhere(
  fieldPath: string,
  val: unknown,
  groupFields: Set<string>,
): val is Where {
  return (
    groupFields.has(fieldPath) &&
    val !== null &&
    typeof val === 'object' &&
    !(val instanceof Date) &&
    !Array.isArray(val)
  )
}

function validateWhereEntry(
  key: string,
  val: unknown,
  fieldPath: string,
  allowed: Set<string>,
  groupFields: Set<string>,
  issues: QueryValidationIssue[],
): void {
  if (key === 'and' || key === 'or') {
    validateLogicalGroup(fieldPath, val, allowed, groupFields, issues)
    return
  }

  if (isNestedGroupWhere(fieldPath, val, groupFields)) {
    validateWhereNode(val, allowed, groupFields, fieldPath, issues)
    return
  }

  if (!allowed.has(fieldPath) && !allowed.has(key)) {
    issues.push({
      path: fieldPath,
      message: `Unknown field "${key}"`,
    })
    return
  }

  validateFieldFilter(fieldPath, val, issues)
}

function validateWhereNode(
  where: Where,
  allowed: Set<string>,
  groupFields: Set<string>,
  currentPath: string,
  issues: QueryValidationIssue[],
): void {
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue
    const fieldPath = currentPath ? `${currentPath}.${key}` : key
    validateWhereEntry(key, val, fieldPath, allowed, groupFields, issues)
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
  const groupFields = getGroupFields(collection)
  const issues: QueryValidationIssue[] = []
  validateWhereNode(where, allowed, groupFields, '', issues)
  return issues
}
