import type { CollectionConfig, LocalizationConfig } from '../config/types'
import type { Field } from '../fields/types'
import {
  BASE_SYSTEM_FIELDS,
  DRAFT_SYSTEM_FIELDS,
  UPLOAD_SYSTEM_FIELDS,
} from '../client/system-fields'
import { KNOWN_OPERATORS, parseSort } from './parser'
import type { SortItem, Where } from './types'

export interface QueryValidationIssue {
  path: string
  message: string
}

function extractLocaleList(localization?: LocalizationConfig): string[] {
  if (!localization) return []
  return localization.locales.map((l) => (typeof l === 'string' ? l : l.code))
}

function addLocalizedVariations(allowed: Set<string>, path: string, locales: string[]): void {
  for (const loc of locales) {
    allowed.add(`${path}_${loc}`)
  }
}

function addGroupFieldToAllowed(
  allowed: Set<string>,
  name: string,
  field: Field,
  locales: string[],
  parentLocalized: boolean,
): void {
  if (field.type !== 'group') return
  for (const [subName, subField] of Object.entries(field.fields)) {
    addFieldToAllowed(allowed, `${name}.${subName}`, subField, locales, parentLocalized)
    addFieldToAllowed(allowed, `${name}__${subName}`, subField, locales, parentLocalized)
  }
}

function addArrayFieldToAllowed(
  allowed: Set<string>,
  name: string,
  field: Field,
  locales: string[],
  parentLocalized: boolean,
): void {
  if (field.type !== 'array') return
  allowed.add(`${name}.id`)
  allowed.add(`${name}__id`)
  if (parentLocalized && locales.length > 0) {
    for (const loc of locales) {
      allowed.add(`${name}_${loc}.id`)
      allowed.add(`${name}_${loc}__id`)
    }
  }
  for (const [subName, subField] of Object.entries(field.fields)) {
    addFieldToAllowed(allowed, `${name}.${subName}`, subField, locales, false)
    addFieldToAllowed(allowed, `${name}__${subName}`, subField, locales, false)
    if (subField.localized && locales.length > 0) {
      for (const loc of locales) {
        allowed.add(`${name}.${subName}.${loc}`)
        allowed.add(`${name}__${subName}__${loc}`)
      }
    }
  }
}

function addBlockSubFieldToAllowed(
  allowed: Set<string>,
  name: string,
  blockSlug: string,
  subName: string,
  subField: Field,
  locales: string[],
): void {
  addFieldToAllowed(allowed, `${name}.${subName}`, subField, locales, false)
  addFieldToAllowed(allowed, `${name}__${subName}`, subField, locales, false)
  addFieldToAllowed(allowed, `${name}.${blockSlug}.${subName}`, subField, locales, false)
  addFieldToAllowed(allowed, `${name}__${blockSlug}__${subName}`, subField, locales, false)
  if (subField.localized && locales.length > 0) {
    for (const loc of locales) {
      allowed.add(`${name}.${subName}.${loc}`)
      allowed.add(`${name}__${subName}__${loc}`)
      allowed.add(`${name}.${blockSlug}.${subName}.${loc}`)
      allowed.add(`${name}__${blockSlug}__${subName}__${loc}`)
    }
  }
}

function addBlocksFieldToAllowed(
  allowed: Set<string>,
  name: string,
  field: Field,
  locales: string[],
  parentLocalized: boolean,
): void {
  if (field.type !== 'blocks') return
  allowed.add(`${name}.id`)
  allowed.add(`${name}__id`)
  allowed.add(`${name}.blockType`)
  allowed.add(`${name}__blockType`)
  if (parentLocalized && locales.length > 0) {
    for (const loc of locales) {
      allowed.add(`${name}_${loc}.id`)
      allowed.add(`${name}_${loc}__id`)
      allowed.add(`${name}_${loc}.blockType`)
      allowed.add(`${name}_${loc}__blockType`)
    }
  }
  for (const block of field.blocks) {
    for (const [subName, subField] of Object.entries(block.fields)) {
      addBlockSubFieldToAllowed(allowed, name, block.slug, subName, subField, locales)
    }
  }
}

function addPointFieldToAllowed(
  allowed: Set<string>,
  name: string,
  field: Field,
  locales: string[],
  parentLocalized: boolean,
): void {
  if (field.type !== 'point') return
  const isLoc = parentLocalized || Boolean(field.localized)
  const subKeys = ['lng', 'longitude', 'lat', 'latitude']
  for (const sub of subKeys) {
    allowed.add(`${name}.${sub}`)
    allowed.add(`${name}__${sub}`)
    if (isLoc && locales.length > 0) {
      for (const loc of locales) {
        allowed.add(`${name}.${sub}_${loc}`)
        allowed.add(`${name}__${sub}_${loc}`)
        allowed.add(`${name}.${sub}.${loc}`)
        allowed.add(`${name}__${sub}__${loc}`)
        allowed.add(`${name}_${loc}.${sub}`)
        allowed.add(`${name}_${loc}__${sub}`)
      }
    }
  }
}

function addFieldToAllowed(
  allowed: Set<string>,
  name: string,
  field: Field,
  locales: string[],
  parentLocalized = false,
): void {
  allowed.add(name)
  const isLoc = parentLocalized || Boolean(field.localized)
  if (isLoc && locales.length > 0) {
    addLocalizedVariations(allowed, name, locales)
  }
  addPointFieldToAllowed(allowed, name, field, locales, isLoc)
  addGroupFieldToAllowed(allowed, name, field, locales, isLoc)
  addArrayFieldToAllowed(allowed, name, field, locales, isLoc)
  addBlocksFieldToAllowed(allowed, name, field, locales, isLoc)
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

export function getAllowedFields(
  collection: CollectionConfig,
  localization?: LocalizationConfig,
): Set<string> {
  const allowed = new Set<string>(BASE_SYSTEM_FIELDS)
  if (collection.versions?.drafts) {
    for (const f of DRAFT_SYSTEM_FIELDS) {
      allowed.add(f)
    }
  }
  if (collection.upload) {
    for (const f of UPLOAD_SYSTEM_FIELDS) {
      allowed.add(f)
    }
  }
  const locales = extractLocaleList(localization)
  for (const [name, field] of Object.entries(collection.fields)) {
    addFieldToAllowed(allowed, name, field, locales, false)
  }
  return allowed
}

function validateJsonFieldFilter(
  fieldPath: string,
  filter: unknown,
  issues: QueryValidationIssue[],
): void {
  if (filter === null) {
    return
  }
  if (typeof filter !== 'object' || Array.isArray(filter) || filter instanceof Date) {
    issues.push({
      path: fieldPath,
      message: `Field "${fieldPath}" of type "json" only supports nullability filters`,
    })
    return
  }
  for (const [op, val] of Object.entries(filter)) {
    if (op !== 'equals' && op !== 'not_equals') {
      issues.push({
        path: `${fieldPath}.${op}`,
        message: `Operator "${op}" is not supported on json field "${fieldPath}"`,
      })
    } else if (val !== null) {
      issues.push({
        path: `${fieldPath}.${op}`,
        message: `Operator "${op}" on json field "${fieldPath}" only supports null`,
      })
    }
  }
}

function validatePointFieldFilter(
  fieldPath: string,
  filter: unknown,
  issues: QueryValidationIssue[],
): void {
  if (filter === null) {
    return
  }
  if (typeof filter !== 'object' || Array.isArray(filter) || filter instanceof Date) {
    issues.push({
      path: fieldPath,
      message: `Field "${fieldPath}" of type "point" only supports nullability filters or coordinate subpaths`,
    })
    return
  }
  for (const [op, val] of Object.entries(filter)) {
    if (op !== 'equals' && op !== 'not_equals') {
      issues.push({
        path: `${fieldPath}.${op}`,
        message: `Operator "${op}" is not supported on point field "${fieldPath}"`,
      })
    } else if (val !== null) {
      issues.push({
        path: `${fieldPath}.${op}`,
        message: `Operator "${op}" on point field "${fieldPath}" only supports null`,
      })
    }
  }
}

function validateSpecialTopFieldFilter(
  collection: CollectionConfig,
  fieldPath: string,
  filter: unknown,
  issues: QueryValidationIssue[],
): boolean {
  const topKey = getTopKey(fieldPath)
  const topField = resolveTopField(collection, topKey)
  if (topField?.type === 'json') {
    validateJsonFieldFilter(fieldPath, filter, issues)
    return true
  }
  if (topField?.type === 'point' && fieldPath === topKey) {
    validatePointFieldFilter(fieldPath, filter, issues)
    return true
  }
  return false
}

function validateFieldFilter(
  fieldPath: string,
  filter: unknown,
  issues: QueryValidationIssue[],
  collection?: CollectionConfig,
): void {
  if (collection && validateSpecialTopFieldFilter(collection, fieldPath, filter, issues)) {
    return
  }

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
  collection?: CollectionConfig,
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
    validateWhereNode(item as Where, allowed, groupFields, itemPath, issues, collection)
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
  collection?: CollectionConfig,
): void {
  if (key === 'and' || key === 'or') {
    validateLogicalGroup(fieldPath, val, allowed, groupFields, issues, collection)
    return
  }

  if (isNestedGroupWhere(fieldPath, val, groupFields)) {
    validateWhereNode(val, allowed, groupFields, fieldPath, issues, collection)
    return
  }

  if (!allowed.has(fieldPath) && !allowed.has(key)) {
    issues.push({
      path: fieldPath,
      message: `Unknown field "${key}"`,
    })
    return
  }

  validateFieldFilter(fieldPath, val, issues, collection)
}

function validateWhereNode(
  where: Where,
  allowed: Set<string>,
  groupFields: Set<string>,
  currentPath: string,
  issues: QueryValidationIssue[],
  collection?: CollectionConfig,
): void {
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue
    const fieldPath = currentPath ? `${currentPath}.${key}` : key
    validateWhereEntry(key, val, fieldPath, allowed, groupFields, issues, collection)
  }
}

export function validateWhere(
  where: Where | undefined,
  collection: CollectionConfig,
  localization?: LocalizationConfig,
): QueryValidationIssue[] {
  if (!where || typeof where !== 'object') {
    return []
  }
  const allowed = getAllowedFields(collection, localization)
  const groupFields = getGroupFields(collection)
  const issues: QueryValidationIssue[] = []
  validateWhereNode(where, allowed, groupFields, '', issues, collection)
  return issues
}

// -----------------------------------------------------------------------------
// Sort validation
// -----------------------------------------------------------------------------

function isScalarSortable(field: Field): boolean {
  if ('hasMany' in field && field.hasMany) return false
  return (
    field.type !== 'group' &&
    field.type !== 'array' &&
    field.type !== 'blocks' &&
    field.type !== 'richText' &&
    field.type !== 'json' &&
    field.type !== 'point'
  )
}

function addPointSortableFields(
  sortable: Set<string>,
  basePath: string,
  locales: string[],
  isLoc: boolean,
): void {
  const subPaths = [
    `${basePath}.lng`,
    `${basePath}__lng`,
    `${basePath}.longitude`,
    `${basePath}__longitude`,
    `${basePath}.lat`,
    `${basePath}__lat`,
    `${basePath}.latitude`,
    `${basePath}__latitude`,
  ]
  for (const p of subPaths) {
    sortable.add(p)
  }
  if (isLoc && locales.length > 0) {
    for (const p of subPaths) {
      addLocalizedVariations(sortable, p, locales)
    }
  }
}

function collectSortableGroupFields(
  sortable: Set<string>,
  groupName: string,
  fields: Record<string, Field>,
  locales: string[],
  parentLocalized = false,
): void {
  for (const [subName, subField] of Object.entries(fields)) {
    const dotPath = `${groupName}.${subName}`
    const underPath = `${groupName}__${subName}`
    const isLoc = parentLocalized || Boolean(subField.localized)
    if (isScalarSortable(subField)) {
      sortable.add(dotPath)
      sortable.add(underPath)
      if (isLoc && locales.length > 0) {
        addLocalizedVariations(sortable, dotPath, locales)
        addLocalizedVariations(sortable, underPath, locales)
      }
    } else if (subField.type === 'point') {
      addPointSortableFields(sortable, dotPath, locales, isLoc)
      addPointSortableFields(sortable, underPath, locales, isLoc)
    } else if (subField.type === 'group') {
      collectSortableGroupFields(sortable, dotPath, subField.fields, locales, isLoc)
      collectSortableGroupFields(sortable, underPath, subField.fields, locales, isLoc)
    }
  }
}

function addSystemSortableFields(sortable: Set<string>, collection: CollectionConfig): void {
  for (const f of BASE_SYSTEM_FIELDS) {
    sortable.add(f)
  }
  if (collection.versions?.drafts) {
    for (const f of DRAFT_SYSTEM_FIELDS) {
      sortable.add(f)
    }
  }
  if (collection.upload) {
    for (const f of UPLOAD_SYSTEM_FIELDS) {
      sortable.add(f)
    }
  }
}

function collectSortableFields(
  collection: CollectionConfig,
  localization?: LocalizationConfig,
): Set<string> {
  const sortable = new Set<string>()
  addSystemSortableFields(sortable, collection)
  const locales = extractLocaleList(localization)
  for (const [name, field] of Object.entries(collection.fields)) {
    const isLoc = Boolean(field.localized)
    if (isScalarSortable(field)) {
      sortable.add(name)
      if (isLoc && locales.length > 0) {
        addLocalizedVariations(sortable, name, locales)
      }
    } else if (field.type === 'point') {
      addPointSortableFields(sortable, name, locales, isLoc)
    } else if (field.type === 'group') {
      collectSortableGroupFields(sortable, name, field.fields, locales, isLoc)
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

function resolveTopField(collection: CollectionConfig, topKey: string): Field | undefined {
  if (collection.fields[topKey]) return collection.fields[topKey]
  const match = topKey.match(/^(.+)_([a-zA-Z0-9-]+)$/)
  if (match && match[1]) {
    const baseField = collection.fields[match[1]]
    if (baseField?.localized) return baseField
  }
  return undefined
}

function isArrayOrBlocksPath(collection: CollectionConfig, fieldPath: string): boolean {
  const topKey = getTopKey(fieldPath)
  const field = resolveTopField(collection, topKey)
  return field?.type === 'array' || field?.type === 'blocks'
}

function isContainerField(collection: CollectionConfig, fieldPath: string): boolean {
  const field = resolveTopField(collection, fieldPath)
  return field?.type === 'group' || field?.type === 'array' || field?.type === 'blocks'
}

function isDisallowedSortType(type?: string): boolean {
  return type === 'richText' || type === 'json' || type === 'point'
}

function checkDisallowedTypeSort(
  topField: Field | undefined,
  topKey: string,
  field: string,
): QueryValidationIssue | null {
  if (topKey !== field || !topField) return null
  if ('hasMany' in topField && topField.hasMany) {
    return {
      path: field,
      message: `Cannot sort on field "${field}" with hasMany: true`,
    }
  }
  if (isDisallowedSortType(topField.type)) {
    return {
      path: field,
      message: `Cannot sort on field "${field}" of type "${topField.type}"`,
    }
  }
  return null
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
  const topField = resolveTopField(collection, topKey)
  return checkDisallowedTypeSort(topField, topKey, field)
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
  localization?: LocalizationConfig,
): QueryValidationIssue[] {
  const items = normalizeSortItems(sort)
  if (items.length === 0) return []

  const sortable = collectSortableFields(collection, localization)
  const issues: QueryValidationIssue[] = []

  for (const item of items) {
    const issue = validateSingleSortItem(item, collection, sortable)
    if (issue) issues.push(issue)
  }

  return issues
}
