import type { CollectionConfig } from '../config/types'
import type { Field } from '../fields/types'
import { SYSTEM_FIELDS, UPLOAD_SYSTEM_FIELDS } from '../client/system-fields'
import { KNOWN_OPERATORS, parseSort } from './parser'
import type { SortItem, Where } from './types'

export interface QueryValidationIssue {
  path: string
  message: string
}

function addGroupFieldToAllowed(allowed: Set<string>, name: string, field: Field): void {
  if (field.type !== 'group') return
  for (const [subName, subField] of Object.entries(field.fields)) {
    addFieldToAllowed(allowed, `${name}.${subName}`, subField)
    addFieldToAllowed(allowed, `${name}__${subName}`, subField)
  }
}

function addArrayFieldToAllowed(allowed: Set<string>, name: string, field: Field): void {
  if (field.type !== 'array') return
  allowed.add(`${name}.id`)
  allowed.add(`${name}__id`)
  for (const [subName, subField] of Object.entries(field.fields)) {
    addFieldToAllowed(allowed, `${name}.${subName}`, subField)
    addFieldToAllowed(allowed, `${name}__${subName}`, subField)
  }
}

function addBlocksFieldToAllowed(allowed: Set<string>, name: string, field: Field): void {
  if (field.type !== 'blocks') return
  allowed.add(`${name}.id`)
  allowed.add(`${name}__id`)
  allowed.add(`${name}.blockType`)
  allowed.add(`${name}__blockType`)
  for (const block of field.blocks) {
    for (const [subName, subField] of Object.entries(block.fields)) {
      addFieldToAllowed(allowed, `${name}.${subName}`, subField)
      addFieldToAllowed(allowed, `${name}__${subName}`, subField)
      addFieldToAllowed(allowed, `${name}.${block.slug}.${subName}`, subField)
      addFieldToAllowed(allowed, `${name}__${block.slug}__${subName}`, subField)
    }
  }
}

function addFieldToAllowed(allowed: Set<string>, name: string, field: Field): void {
  allowed.add(name)
  addGroupFieldToAllowed(allowed, name, field)
  addArrayFieldToAllowed(allowed, name, field)
  addBlocksFieldToAllowed(allowed, name, field)
}

function collectBlocksContainerPaths(containers: Set<string>, current: string, field: Field): void {
  if (field.type !== 'blocks') return
  for (const block of field.blocks) {
    containers.add(`${current}.${block.slug}`)
    containers.add(`${current}__${block.slug}`)
    for (const [subName, subField] of Object.entries(block.fields)) {
      collectContainerPaths(containers, subName, subField, current)
    }
  }
}

function collectContainerPaths(
  containers: Set<string>,
  name: string,
  field: Field,
  prefix = '',
): void {
  const current = prefix ? `${prefix}.${name}` : name
  if (field.type === 'group' || field.type === 'array') {
    containers.add(current)
    containers.add(prefix ? `${prefix}__${name}` : name)
    for (const [subName, subField] of Object.entries(field.fields)) {
      collectContainerPaths(containers, subName, subField, current)
    }
  } else if (field.type === 'blocks') {
    containers.add(current)
    containers.add(prefix ? `${prefix}__${name}` : name)
    collectBlocksContainerPaths(containers, current, field)
  }
}

export function getGroupFields(collection: CollectionConfig): Set<string> {
  const containers = new Set<string>()
  for (const [name, field] of Object.entries(collection.fields)) {
    collectContainerPaths(containers, name, field)
  }
  return containers
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

// -----------------------------------------------------------------------------
// Sort validation
// -----------------------------------------------------------------------------

function isScalarSortable(field: Field): boolean {
  if (field.type === 'relationship' && field.hasMany) return false
  return (
    field.type !== 'group' &&
    field.type !== 'array' &&
    field.type !== 'blocks' &&
    field.type !== 'richText'
  )
}

function collectSortableGroupFields(
  sortable: Set<string>,
  groupName: string,
  fields: Record<string, Field>,
): void {
  for (const [subName, subField] of Object.entries(fields)) {
    const dotPath = `${groupName}.${subName}`
    const underPath = `${groupName}__${subName}`
    if (isScalarSortable(subField)) {
      sortable.add(dotPath)
      sortable.add(underPath)
    } else if (subField.type === 'group') {
      collectSortableGroupFields(sortable, dotPath, subField.fields)
      collectSortableGroupFields(sortable, underPath, subField.fields)
    }
  }
}

function collectSortableFields(collection: CollectionConfig): Set<string> {
  const sortable = new Set<string>(SYSTEM_FIELDS)
  if (collection.upload) {
    for (const f of UPLOAD_SYSTEM_FIELDS) {
      sortable.add(f)
    }
  }
  for (const [name, field] of Object.entries(collection.fields)) {
    if (isScalarSortable(field)) {
      sortable.add(name)
    } else if (field.type === 'group') {
      collectSortableGroupFields(sortable, name, field.fields)
    }
  }
  return sortable
}

export function getTopKey(fieldName: string): string {
  const dot = fieldName.indexOf('.')
  const dunder = fieldName.indexOf('__')
  if (dot === -1 && dunder === -1) return fieldName
  if (dot === -1) return fieldName.slice(0, dunder)
  if (dunder === -1) return fieldName.slice(0, dot)
  return fieldName.slice(0, Math.min(dot, dunder))
}

function isArrayOrBlocksPath(collection: CollectionConfig, fieldPath: string): boolean {
  const topKey = getTopKey(fieldPath)
  const field = collection.fields[topKey]
  return field?.type === 'array' || field?.type === 'blocks'
}

function isContainerField(collection: CollectionConfig, fieldPath: string): boolean {
  const field = collection.fields[fieldPath]
  return field?.type === 'group' || field?.type === 'array' || field?.type === 'blocks'
}

function checkDisallowedSortField(
  collection: CollectionConfig,
  field: string,
): QueryValidationIssue | null {
  if (isArrayOrBlocksPath(collection, field)) {
    return {
      path: field,
      message: `Sorting on array or blocks field "${field}" is not supported`,
    }
  }
  if (isContainerField(collection, field)) {
    return {
      path: field,
      message: `Cannot sort on container field "${field}"`,
    }
  }
  const topKey = getTopKey(field)
  const topField = collection.fields[topKey]
  if (topField?.type === 'richText' && topKey === field) {
    return {
      path: field,
      message: `Cannot sort on field "${field}" of type "richText"`,
    }
  }
  return null
}

function validateSingleSortItem(
  item: SortItem,
  collection: CollectionConfig,
  sortable: Set<string>,
): QueryValidationIssue | null {
  const disallowed = checkDisallowedSortField(collection, item.field)
  if (disallowed) return disallowed

  if (!sortable.has(item.field)) {
    return {
      path: item.field,
      message: `Unknown field "${item.field}"`,
    }
  }
  return null
}

function normalizeSortItems(sort: string | string[] | SortItem[] | undefined): SortItem[] {
  if (!sort) return []
  if (Array.isArray(sort)) {
    if (sort.length > 0 && typeof sort[0] === 'object' && 'field' in sort[0]) {
      return sort as SortItem[]
    }
    return parseSort(sort as string[])
  }
  return parseSort(sort)
}

export function validateSort(
  sort: string | string[] | SortItem[] | undefined,
  collection: CollectionConfig,
): QueryValidationIssue[] {
  const items = normalizeSortItems(sort)
  if (items.length === 0) return []

  const sortable = collectSortableFields(collection)
  const issues: QueryValidationIssue[] = []

  for (const item of items) {
    const issue = validateSingleSortItem(item, collection, sortable)
    if (issue) issues.push(issue)
  }

  return issues
}
