import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import mysql from 'mysql2/promise'
import {
  generateRowId,
  parseSort,
  type Block,
  type CollectionConfig,
  type Config,
  type DatabaseAdapter,
  type DocumentData,
  type Field,
  type Fields,
  type FilterOperator,
  type FindArgs,
  type GlobalConfig,
  type GroupField,
  type PaginatedDocs,
  type SortItem,
  type StoredDoc,
  type Where,
} from '@lontar/core'
import { authTables } from './schema/auth'
import { generateSchemaFile } from './schema/generator'
import {
  collectionToTable,
  flattenGroupFields,
  getCollectionJunctionTables,
  globalToTable,
  type DynamicTable,
  type JunctionTable,
} from './schema/table'
import { handleDatabaseError, toErrorContext } from './errors'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'

export interface MysqlAdapterOptions {
  url: string
}

export type MysqlAdapter = DatabaseAdapter & {
  close(): Promise<void>
}

type InsertValues = Parameters<ReturnType<ReturnType<typeof drizzle>['insert']>['values']>[0]
type UpdateSetValues = Parameters<ReturnType<ReturnType<typeof drizzle>['update']>['set']>[0]

function unflattenSubField(
  row: Record<string, unknown>,
  colName: string,
  subField: Field,
): { value: unknown; hasValue: boolean } {
  if (subField.type === 'group') {
    const nested = unflattenGroupField(row, colName, subField)
    return { value: nested, hasValue: nested !== null }
  }
  const val = row[colName]
  const value = val instanceof Date ? val.toISOString() : (val ?? null)
  return { value, hasValue: val !== null && val !== undefined }
}

function unflattenGroupField(
  row: Record<string, unknown>,
  prefix: string,
  groupField: GroupField,
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}
  let hasAnyNonNull = false
  for (const [subName, subField] of Object.entries(groupField.fields)) {
    const colName = `${prefix}__${subName}`
    const { value, hasValue } = unflattenSubField(row, colName, subField)
    result[subName] = value
    if (hasValue) {
      hasAnyNonNull = true
    }
  }
  if (!hasAnyNonNull && !groupField.required) {
    return null
  }
  return result
}

function unflattenDoc(doc: Record<string, unknown>, fields?: Fields): Record<string, unknown> {
  if (!fields) return doc
  const result: Record<string, unknown> = { ...doc }
  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.type === 'group') {
      result[fieldName] = unflattenGroupField(doc, fieldName, field)
    }
  }
  for (const key of Object.keys(result)) {
    if (key.includes('__')) {
      delete result[key]
    }
  }
  return result
}

function toStoredDoc(row: Record<string, unknown>, fields?: Fields): StoredDoc {
  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      converted[key] = value.toISOString()
    } else {
      converted[key] = value
    }
  }
  const baseDoc = {
    ...converted,
    id: Number(row.id),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
  return unflattenDoc(baseDoc, fields) as StoredDoc
}

function normalizeDateString(str: string): string {
  const trimmed = str.trim()
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`
  }
  return trimmed
}

function sanitizeDate(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value === 'string') {
    return new Date(normalizeDateString(value))
  }
  return value
}

function sanitizeRichText(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

function sanitizeRelationship(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

function sanitizeArray(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  let arr: unknown = value
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr) as unknown
    } catch {
      return null
    }
  }
  if (!Array.isArray(arr)) return null
  return arr.map((item: unknown): unknown => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      if (!('id' in record) || !record.id) {
        return { ...record, id: generateRowId() }
      }
      return record
    }
    return item
  })
}

function sanitizeFieldValue(
  field: CollectionConfig['fields'][string] | undefined,
  value: unknown,
): unknown {
  if (!field) return value
  switch (field.type) {
    case 'date':
      return sanitizeDate(value)
    case 'richText':
      return sanitizeRichText(value)
    case 'relationship':
      return sanitizeRelationship(value)
    case 'array':
    case 'blocks':
      return sanitizeArray(value)
    default:
      return value
  }
}

function flattenGroupValue(
  groupField: GroupField,
  val: unknown,
  colName: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (val === null) {
    const flatGroup = flattenGroupFields(groupField.fields, colName)
    for (const flatCol of flatGroup) {
      result[flatCol.name] = null
    }
    return result
  }
  if (!val || typeof val !== 'object') return result

  for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
    const subField = groupField.fields[subKey]
    if (!subField) continue
    const fullCol = `${colName}__${subKey}`
    if (subField.type === 'group') {
      Object.assign(result, flattenGroupValue(subField, subVal, fullCol))
    } else if (!(subField.type === 'relationship' && subField.hasMany)) {
      result[fullCol] = sanitizeFieldValue(subField, subVal)
    }
  }
  return result
}

function sanitizeEntry(
  clean: Record<string, unknown>,
  fields: Fields,
  key: string,
  value: unknown,
): void {
  const field = fields[key]
  if (field?.type === 'group') {
    Object.assign(clean, flattenGroupValue(field, value, key))
  } else if (!(field?.type === 'relationship' && field.hasMany)) {
    clean[key] = sanitizeFieldValue(field, value)
  }
}

function sanitizeData(schema: { fields: Fields }, data: DocumentData): DocumentData {
  const clean: DocumentData = {}
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
      sanitizeEntry(clean, schema.fields, key, value)
    }
  }
  return clean
}

function castSystemField(fieldName: string, value: unknown): unknown {
  if (fieldName === 'id') {
    const num = Number(value)
    return Number.isNaN(num) ? value : num
  }
  if (fieldName === 'createdAt' || fieldName === 'updatedAt') {
    return typeof value === 'string' ? new Date(value) : value
  }
  return undefined
}

function castCheckbox(value: unknown): boolean {
  if (value === 'true' || value === '1' || value === 1 || value === true) return true
  if (value === 'false' || value === '0' || value === 0 || value === false) return false
  return Boolean(value)
}

function castConfigField(
  field: CollectionConfig['fields'][string] | undefined,
  value: unknown,
): unknown {
  if (!field) return value
  if (field.type === 'number' || field.type === 'relationship') {
    const num = Number(value)
    return Number.isNaN(num) ? value : num
  }
  if (field.type === 'date') {
    return typeof value === 'string' ? new Date(normalizeDateString(value)) : value
  }
  if (field.type === 'checkbox') {
    return castCheckbox(value)
  }
  return value
}

function findFieldInBlocks(blocks: readonly Block[], name: string): Field | undefined {
  for (const b of blocks) {
    if (b.fields[name]) return b.fields[name]
  }
  return undefined
}

function resolveBlocksNext(
  field: Field,
  parts: string[],
  currentIndex: number,
): { nextFields?: Fields; foundField?: Field; skipCount: number } | null {
  if (field.type !== 'blocks') return null
  const nextPart = parts[currentIndex + 1] ?? ''
  if (nextPart === 'id' || nextPart === 'blockType') {
    return { foundField: { type: 'text', required: true }, skipCount: 1 }
  }
  const block = field.blocks.find((b) => b.slug === nextPart)
  if (block) {
    return { nextFields: block.fields, skipCount: 1 }
  }
  const found = findFieldInBlocks(field.blocks, nextPart)
  if (!found) return null
  if (currentIndex + 1 === parts.length - 1) {
    return { foundField: found, skipCount: 1 }
  }
  if (found.type === 'group' || found.type === 'array') {
    return { nextFields: found.fields, skipCount: 1 }
  }
  return null
}

interface ResolveStepResult {
  done?: boolean
  field?: Field
  nextFields?: Fields
  skipCount?: number
}

function resolveStep(f: Field, parts: string[], i: number): ResolveStepResult {
  if (i === parts.length - 1) {
    return { done: true, field: f }
  }
  if (f.type === 'group' || f.type === 'array') {
    if (parts[i + 1] === 'id') {
      return { done: true, field: { type: 'text', required: true } }
    }
    return { nextFields: f.fields, skipCount: 0 }
  }
  const blocksResult = resolveBlocksNext(f, parts, i)
  if (!blocksResult) {
    return { done: true, field: undefined }
  }
  if (blocksResult.foundField) {
    return { done: true, field: blocksResult.foundField }
  }
  return { nextFields: blocksResult.nextFields, skipCount: blocksResult.skipCount }
}

function resolveField(fields: Fields, fieldPath: string): Field | undefined {
  const parts = fieldPath.includes('.') ? fieldPath.split('.') : fieldPath.split('__')
  let currentFields: Fields = fields

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) return undefined
    const f: Field | undefined = currentFields[part]
    if (!f) return undefined

    const step = resolveStep(f, parts, i)
    if (step.done) return step.field
    if (step.nextFields) {
      currentFields = step.nextFields
      i += step.skipCount ?? 0
    }
  }
  return undefined
}

function castFieldValue(collection: CollectionConfig, fieldName: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  const sysVal = castSystemField(fieldName, value)
  if (sysVal !== undefined) return sysVal
  const field = resolveField(collection.fields, fieldName)
  return castConfigField(field, value)
}

function buildBasicCondition(
  column: AnyMySqlColumn,
  operator: FilterOperator,
  value: unknown,
): SQL | undefined {
  switch (operator) {
    case 'equals':
      return eq(column, value)
    case 'not_equals':
      return ne(column, value)
    case 'contains':
      return like(column, `%${String(value)}%`)
    case 'in': {
      const arr = Array.isArray(value) ? value : [value]
      return arr.length > 0 ? inArray(column, arr) : undefined
    }
    default:
      return undefined
  }
}

function buildComparisonCondition(
  column: AnyMySqlColumn,
  operator: FilterOperator,
  value: unknown,
): SQL | undefined {
  switch (operator) {
    case 'greater_than':
      return gt(column, value)
    case 'less_than':
      return lt(column, value)
    case 'greater_than_equal':
      return gte(column, value)
    case 'less_than_equal':
      return lte(column, value)
    default:
      return undefined
  }
}

function buildCondition(
  column: AnyMySqlColumn,
  operator: FilterOperator,
  value: unknown,
): SQL | undefined {
  return (
    buildBasicCondition(column, operator, value) ??
    buildComparisonCondition(column, operator, value)
  )
}

function parseHasManyOpCondition(
  table: DynamicTable,
  junctionTable: JunctionTable,
  op: string,
  val: unknown,
): SQL | undefined {
  if (val === undefined || val === null) return undefined
  if (op === 'equals') {
    const id = Number(val)
    return Number.isNaN(id)
      ? undefined
      : sql`${table.id} IN (SELECT ${junctionTable.parentId} FROM ${junctionTable} WHERE ${junctionTable.targetId} = ${id})`
  }
  if (op === 'not_equals') {
    const id = Number(val)
    return Number.isNaN(id)
      ? undefined
      : sql`${table.id} NOT IN (SELECT ${junctionTable.parentId} FROM ${junctionTable} WHERE ${junctionTable.targetId} = ${id})`
  }
  if (op === 'in') {
    const arr = Array.isArray(val) ? val : [val]
    const ids = arr.map(Number).filter((n) => !Number.isNaN(n))
    return ids.length > 0
      ? sql`${table.id} IN (SELECT ${junctionTable.parentId} FROM ${junctionTable} WHERE ${inArray(junctionTable.targetId, ids)})`
      : undefined
  }
  return undefined
}

function parseHasManyConditions(
  table: DynamicTable,
  junctionTable: JunctionTable | undefined,
  filter: unknown,
): SQL[] {
  if (!junctionTable) return []
  if (filter === null || typeof filter !== 'object') {
    const cond = parseHasManyOpCondition(table, junctionTable, 'equals', filter)
    return cond ? [cond] : []
  }

  const conditions: SQL[] = []
  for (const [op, rawVal] of Object.entries(filter as Record<string, unknown>)) {
    const cond = parseHasManyOpCondition(table, junctionTable, op, rawVal)
    if (cond) conditions.push(cond)
  }
  return conditions
}

function parseObjectFilterConditions(
  collection: CollectionConfig,
  column: AnyMySqlColumn,
  fieldName: string,
  filter: Record<string, unknown>,
): SQL[] {
  const conditions: SQL[] = []
  for (const [op, rawVal] of Object.entries(filter)) {
    if (rawVal === undefined) continue
    const val =
      op === 'in' && Array.isArray(rawVal)
        ? rawVal.map((v) => castFieldValue(collection, fieldName, v))
        : castFieldValue(collection, fieldName, rawVal)

    const cond = buildCondition(column, op as FilterOperator, val)
    if (cond) conditions.push(cond)
  }
  return conditions
}

interface JsonPathInfo {
  jsonPath: string
  blockType?: string
  subSegments?: string[]
}

function resolveJsonPathInfo(field: Field, fieldName: string, topKey: string): JsonPathInfo {
  const prefixLength = fieldName.startsWith(topKey + '__') ? topKey.length + 2 : topKey.length + 1
  const subPath = fieldName.slice(prefixLength)

  if (field.type === 'blocks') {
    for (const block of field.blocks) {
      const dotPrefix = `${block.slug}.`
      const underPrefix = `${block.slug}__`
      if (subPath.startsWith(dotPrefix) || subPath.startsWith(underPrefix)) {
        const sepLength = subPath.startsWith(dotPrefix) ? dotPrefix.length : underPrefix.length
        const remaining = subPath.slice(sepLength)
        const subSegments = remaining.split(/\.|__/).filter(Boolean)
        const jsonPath = '$[*].' + remaining.replace(/__/g, '.')
        return { jsonPath, blockType: block.slug, subSegments }
      }
    }
  }

  const subSegments = subPath.split(/\.|__/).filter(Boolean)
  const jsonPath = '$[*].' + subPath.replace(/__/g, '.')
  return { jsonPath, subSegments }
}

function buildNestedCandidate(segments: string[], value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let current = result
  for (let i = 0; i < segments.length - 1; i++) {
    const next: Record<string, unknown> = {}
    current[segments[i]!] = next
    current = next
  }
  current[segments[segments.length - 1]!] = value
  return result
}

function buildBlockCandidate(
  blockType: string,
  subSegments: string[],
  value: unknown,
): Record<string, unknown> {
  const nested = buildNestedCandidate(subSegments, value)
  return { blockType, ...nested }
}

function buildBlockInCondition(
  column: AnyMySqlColumn,
  blockType: string,
  subSegments: string[],
  rawVal: unknown,
): SQL | undefined {
  const arr = Array.isArray(rawVal) ? rawVal : [rawVal]
  if (arr.length === 0) return undefined
  const items = arr.map((v) => {
    const candidate = buildBlockCandidate(blockType, subSegments, v)
    const jsonVal = JSON.stringify(candidate)
    return sql`JSON_CONTAINS(${column}, CAST(${jsonVal} AS JSON)) = 1`
  })
  return sql`(${column} IS NOT NULL AND (${sql.join(items, sql` OR `)}))`
}

function buildBlockJsonOpCondition(
  column: AnyMySqlColumn,
  blockType: string,
  subSegments: string[],
  op: string,
  rawVal: unknown,
): SQL | undefined {
  if (op === 'equals') {
    const candidate = buildBlockCandidate(blockType, subSegments, rawVal)
    const jsonVal = JSON.stringify(candidate)
    return sql`(${column} IS NOT NULL AND JSON_CONTAINS(${column}, CAST(${jsonVal} AS JSON)) = 1)`
  }
  if (op === 'not_equals') {
    const candidate = buildBlockCandidate(blockType, subSegments, rawVal)
    const jsonVal = JSON.stringify(candidate)
    return sql`(${column} IS NULL OR JSON_CONTAINS(${column}, CAST(${jsonVal} AS JSON)) = 0)`
  }
  if (op === 'in') {
    return buildBlockInCondition(column, blockType, subSegments, rawVal)
  }
  if (op === 'contains') {
    const strVal =
      typeof rawVal === 'string'
        ? rawVal
        : typeof rawVal === 'number' || typeof rawVal === 'boolean'
          ? String(rawVal)
          : ''
    const pattern = `%${strVal}%`
    const safePath = `'$.${subSegments.join('.').replace(/[^a-zA-Z0-9_.]/g, '')}'`
    return sql`(${column} IS NOT NULL AND (SELECT COUNT(*) FROM JSON_TABLE(${column}, '$[*]' COLUMNS (blockType VARCHAR(255) PATH '$.blockType', val TEXT PATH ${sql.raw(safePath)})) AS jt WHERE jt.blockType = ${blockType} AND jt.val LIKE ${pattern}) > 0)`
  }
  return undefined
}

function buildStandardJsonOpCondition(
  column: AnyMySqlColumn,
  jsonPath: string,
  op: string,
  rawVal: unknown,
): SQL | undefined {
  if (op === 'equals') {
    const jsonVal = JSON.stringify(rawVal)
    return sql`(${column} IS NOT NULL AND JSON_CONTAINS(JSON_EXTRACT(${column}, ${jsonPath}), CAST(${jsonVal} AS JSON)) = 1)`
  }
  if (op === 'not_equals') {
    const jsonVal = JSON.stringify(rawVal)
    return sql`(${column} IS NULL OR JSON_CONTAINS(JSON_EXTRACT(${column}, ${jsonPath}), CAST(${jsonVal} AS JSON)) = 0)`
  }
  if (op === 'in') {
    const arr = Array.isArray(rawVal) ? rawVal : [rawVal]
    const jsonVal = JSON.stringify(arr)
    return sql`(${column} IS NOT NULL AND JSON_OVERLAPS(JSON_EXTRACT(${column}, ${jsonPath}), CAST(${jsonVal} AS JSON)) = 1)`
  }
  if (op === 'contains') {
    const strVal =
      typeof rawVal === 'string'
        ? rawVal
        : typeof rawVal === 'number' || typeof rawVal === 'boolean'
          ? String(rawVal)
          : ''
    const pattern = `%${strVal}%`
    return sql`(${column} IS NOT NULL AND JSON_SEARCH(${column}, 'one', ${pattern}, NULL, ${jsonPath}) IS NOT NULL)`
  }
  return undefined
}

function buildJsonOpCondition(
  column: AnyMySqlColumn,
  pathInfo: JsonPathInfo,
  op: string,
  rawVal: unknown,
): SQL | undefined {
  if (rawVal === undefined) return undefined
  if (pathInfo.blockType && pathInfo.subSegments && pathInfo.subSegments.length > 0) {
    return buildBlockJsonOpCondition(column, pathInfo.blockType, pathInfo.subSegments, op, rawVal)
  }
  return buildStandardJsonOpCondition(column, pathInfo.jsonPath, op, rawVal)
}

function parseJsonArrayConditions(
  column: AnyMySqlColumn,
  pathInfo: JsonPathInfo,
  filter: unknown,
): SQL[] {
  if (filter === null || typeof filter !== 'object') {
    const cond = buildJsonOpCondition(column, pathInfo, 'equals', filter)
    return cond ? [cond] : []
  }
  const conditions: SQL[] = []
  for (const [op, rawVal] of Object.entries(filter as Record<string, unknown>)) {
    const cond = buildJsonOpCondition(column, pathInfo, op, rawVal)
    if (cond) conditions.push(cond)
  }
  return conditions
}

function getTopKey(fieldName: string): string {
  if (fieldName.includes('.')) return fieldName.slice(0, fieldName.indexOf('.'))
  if (fieldName.includes('__')) return fieldName.slice(0, fieldName.indexOf('__'))
  return fieldName
}

function parseJsonFieldConditions(
  collection: CollectionConfig,
  table: DynamicTable,
  fieldName: string,
  filter: unknown,
): SQL[] | null {
  const topKey = getTopKey(fieldName)
  if (topKey === fieldName) return null
  const topField = collection.fields[topKey]
  if (topField?.type !== 'array' && topField?.type !== 'blocks') return null

  if (!Object.hasOwn(table, topKey)) return []
  const column = table[topKey]
  if (!column) return []

  const pathInfo = resolveJsonPathInfo(topField, fieldName, topKey)
  return parseJsonArrayConditions(column, pathInfo, filter)
}

function isContainerFilterObject(
  field: Field | undefined,
  filter: unknown,
): filter is Record<string, unknown> {
  const isContainer = field?.type === 'group' || field?.type === 'array' || field?.type === 'blocks'
  return (
    Boolean(isContainer) &&
    filter !== null &&
    typeof filter === 'object' &&
    !Array.isArray(filter) &&
    !(filter instanceof Date)
  )
}

function parseGroupConditions(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  fieldName: string,
  filter: Record<string, unknown>,
): SQL[] {
  const conditions: SQL[] = []
  for (const [subName, subVal] of Object.entries(filter)) {
    if (subVal === undefined) continue
    const nestedPath = `${fieldName}.${subName}`
    conditions.push(...parseFieldConditions(collection, table, junctionTables, nestedPath, subVal))
  }
  return conditions
}

function parseStandardColumnConditions(
  collection: CollectionConfig,
  column: AnyMySqlColumn,
  fieldName: string,
  filter: unknown,
): SQL[] {
  if (filter === null || typeof filter !== 'object') {
    const val = castFieldValue(collection, fieldName, filter)
    return [eq(column, val)]
  }

  return parseObjectFilterConditions(
    collection,
    column,
    fieldName,
    filter as Record<string, unknown>,
  )
}

function parseFieldConditions(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  fieldName: string,
  filter: unknown,
): SQL[] {
  const field = resolveField(collection.fields, fieldName)
  if (isContainerFilterObject(field, filter)) {
    return parseGroupConditions(collection, table, junctionTables, fieldName, filter)
  }

  const jsonConds = parseJsonFieldConditions(collection, table, fieldName, filter)
  if (jsonConds !== null) {
    return jsonConds
  }

  const colName = fieldName.replace(/\./g, '__')
  if (field?.type === 'relationship' && field.hasMany) {
    const jTable = junctionTables[colName] || junctionTables[fieldName]
    return parseHasManyConditions(table, jTable, filter)
  }

  if (!Object.hasOwn(table, colName)) return []
  const column = table[colName]
  if (!column) return []

  return parseStandardColumnConditions(collection, column, fieldName, filter)
}

function resolveLogicalGroup(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  group: Where[],
  combiner: (...conditions: SQL[]) => SQL | undefined,
): SQL | undefined {
  const clauses = group
    .map((subWhere) => resolveWhere(collection, table, junctionTables, subWhere))
    .filter((c): c is SQL => Boolean(c))
  return clauses.length > 0 ? combiner(...clauses) : undefined
}

function resolveWhereEntry(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  key: string,
  val: unknown,
): SQL | SQL[] | undefined {
  if (key === 'or' && Array.isArray(val)) {
    return resolveLogicalGroup(collection, table, junctionTables, val as Where[], or)
  }
  if (key === 'and' && Array.isArray(val)) {
    return resolveLogicalGroup(collection, table, junctionTables, val as Where[], and)
  }
  return parseFieldConditions(collection, table, junctionTables, key, val)
}

function resolveWhere(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  where?: Where,
): SQL | undefined {
  if (!where || typeof where !== 'object') return undefined

  const clauses: SQL[] = []
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue
    const resolved = resolveWhereEntry(collection, table, junctionTables, key, val)
    if (Array.isArray(resolved)) {
      clauses.push(...resolved)
    } else if (resolved) {
      clauses.push(resolved)
    }
  }

  if (clauses.length === 0) return undefined
  if (clauses.length === 1) return clauses[0]
  return and(...clauses)
}

function resolveOrderBy(table: DynamicTable, sort?: string | SortItem[]): SQL[] {
  const sortItems = Array.isArray(sort)
    ? sort.filter((s): s is SortItem => typeof s === 'object' && 'field' in s)
    : parseSort(sort)

  if (sortItems.length === 0) {
    const createdAtCol = table.createdAt
    return createdAtCol ? [desc(createdAtCol)] : []
  }

  const orderByList: SQL[] = []
  for (const item of sortItems) {
    const colName = item.field.replace(/\./g, '__')
    if (!Object.hasOwn(table, colName)) continue
    const column = table[colName]
    if (column) {
      orderByList.push(item.direction === 'desc' ? desc(column) : asc(column))
    }
  }
  return orderByList
}

type AdapterDb = MySql2Database<typeof authTables>
type TransactionCallback = Parameters<AdapterDb['transaction']>[0]
type AdapterTx = Parameters<TransactionCallback>[0]
type DbExecutor = AdapterDb | AdapterTx

interface AdapterCaches {
  tableCache: Map<string, DynamicTable>
  junctionTablesCache: Map<string, Record<string, JunctionTable>>
}

function getTable(caches: AdapterCaches, collection: CollectionConfig): DynamicTable {
  let table = caches.tableCache.get(collection.slug)
  if (!table) {
    table = collectionToTable(collection)
    caches.tableCache.set(collection.slug, table)
  }
  return table
}

function getJunctionTables(
  caches: AdapterCaches,
  collection: CollectionConfig,
): Record<string, JunctionTable> {
  let tables = caches.junctionTablesCache.get(collection.slug)
  if (!tables) {
    tables = getCollectionJunctionTables(collection)
    caches.junctionTablesCache.set(collection.slug, tables)
  }
  return tables
}

function getGlobalTable(caches: AdapterCaches, global: GlobalConfig): DynamicTable {
  let table = caches.tableCache.get(global.slug)
  if (!table) {
    table = globalToTable(global)
    caches.tableCache.set(global.slug, table)
  }
  return table
}

async function syncSingleHasManyRelation(
  executor: DbExecutor,
  jTable: JunctionTable,
  parentId: number,
  targetIds: unknown,
): Promise<void> {
  await executor.delete(jTable).where(eq(jTable.parentId, parentId))
  if (!Array.isArray(targetIds) || targetIds.length === 0) return

  const rows = targetIds
    .map((tid, index) => ({
      parentId,
      targetId: Number(tid),
      order: index,
    }))
    .filter((row) => !Number.isNaN(row.targetId))

  if (rows.length > 0) {
    await executor.insert(jTable).values(rows)
  }
}

async function fetchJunctionRows(
  executor: DbExecutor,
  jTable: JunctionTable,
  parentIds: number[],
): Promise<Array<{ parentId: number; targetId: number }>> {
  return (await executor
    .select({
      parentId: jTable.parentId,
      targetId: jTable.targetId,
    })
    .from(jTable)
    .where(inArray(jTable.parentId, parentIds))
    .orderBy(asc(jTable.order))) as Array<{ parentId: number; targetId: number }>
}

function extractRelationData(data: DocumentData, name: string): unknown {
  if (name in data) return data[name]
  const parts = name.split('__')
  let cur: unknown = data
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function setTargetRelationIds(doc: StoredDoc, fieldName: string, ids: number[]): void {
  if (!fieldName.includes('__')) {
    doc[fieldName] = ids
    return
  }
  const parts = fieldName.split('__')
  let cur: Record<string, unknown> = doc
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    if (!cur[p] || typeof cur[p] !== 'object') {
      cur[p] = {}
    }
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]!] = ids
}

function pushTargetRelationId(doc: StoredDoc, fieldName: string, targetId: number): void {
  if (!fieldName.includes('__')) {
    ;(doc[fieldName] as number[]).push(targetId)
    return
  }
  const parts = fieldName.split('__')
  let cur: unknown = doc
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return
    cur = (cur as Record<string, unknown>)[p]
  }
  if (Array.isArray(cur)) {
    cur.push(targetId)
  }
}

async function syncHasManyRelations(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  parentId: number,
  data: DocumentData,
): Promise<void> {
  const junctionTables = getJunctionTables(caches, collection)
  for (const [name, jTable] of Object.entries(junctionTables)) {
    const val = extractRelationData(data, name)
    if (val !== undefined) {
      await syncSingleHasManyRelation(executor, jTable, parentId, val)
    }
  }
}

async function populateHasManyRelations(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  docs: StoredDoc[],
): Promise<void> {
  if (docs.length === 0) return
  const junctionTables = getJunctionTables(caches, collection)
  const junctionEntries = Object.entries(junctionTables)
  if (junctionEntries.length === 0) return

  const parentIds = docs.map((d) => d.id)

  for (const [fieldName, jTable] of junctionEntries) {
    for (const doc of docs) {
      setTargetRelationIds(doc, fieldName, [])
    }
    const rows = await fetchJunctionRows(executor, jTable, parentIds)
    for (const row of rows) {
      const doc = docs.find((d) => d.id === row.parentId)
      if (doc) {
        pushTargetRelationId(doc, fieldName, row.targetId)
      }
    }
  }
}

async function findDocByID(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  id: number,
): Promise<StoredDoc | null> {
  try {
    const table = getTable(caches, collection)
    const [row] = (await executor.select().from(table).where(eq(table.id, id)).limit(1)) as [
      Record<string, unknown> | undefined,
    ]
    if (!row) return null
    const doc = toStoredDoc(row, collection.fields)
    await populateHasManyRelations(executor, caches, collection, [doc])
    return doc
  } catch (err) {
    handleDatabaseError(err, toErrorContext(collection))
  }
}

async function createDoc(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  data: DocumentData,
): Promise<StoredDoc> {
  try {
    return await executor.transaction(async (tx) => {
      const table = getTable(caches, collection)
      const values = sanitizeData(collection, data) as unknown as InsertValues
      const [result] = (await tx.insert(table).values(values)) as unknown as [mysql.ResultSetHeader]
      const id = result.insertId
      await syncHasManyRelations(tx, caches, collection, id, data)
      const created = await findDocByID(tx, caches, collection, id)
      if (!created) {
        throw new Error(`Failed to retrieve created document in collection "${collection.slug}".`)
      }
      return created
    })
  } catch (err) {
    handleDatabaseError(err, toErrorContext(collection))
  }
}

async function updateDoc(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  id: number,
  data: DocumentData,
): Promise<StoredDoc | null> {
  try {
    return await executor.transaction(async (tx) => {
      const existing = await findDocByID(tx, caches, collection, id)
      if (!existing) return null

      const table = getTable(caches, collection)
      const values = {
        ...sanitizeData(collection, data),
        updatedAt: new Date(),
      } as unknown as UpdateSetValues
      await tx.update(table).set(values).where(eq(table.id, id))
      await syncHasManyRelations(tx, caches, collection, id, data)
      return findDocByID(tx, caches, collection, id)
    })
  } catch (err) {
    handleDatabaseError(err, toErrorContext(collection))
  }
}

async function removeDoc(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  id: number,
): Promise<StoredDoc | null> {
  try {
    return await executor.transaction(async (tx) => {
      const existing = await findDocByID(tx, caches, collection, id)
      if (!existing) return null

      const junctionTables = getJunctionTables(caches, collection)
      for (const jTable of Object.values(junctionTables)) {
        await tx.delete(jTable).where(eq(jTable.parentId, id))
      }

      const table = getTable(caches, collection)
      await tx.delete(table).where(eq(table.id, id))
      return existing
    })
  } catch (err) {
    handleDatabaseError(err, toErrorContext(collection))
  }
}

function computeSafeLimit(limit: number, maxLimit?: number): number {
  if (limit === 0) return 0
  const positive = Math.max(1, limit)
  return maxLimit !== undefined ? Math.min(positive, maxLimit) : positive
}

async function countMatchingDocs(
  executor: DbExecutor,
  table: DynamicTable,
  whereSql: SQL | undefined,
): Promise<number> {
  const countQuery = executor.select({ value: count() }).from(table)
  if (whereSql) {
    countQuery.where(whereSql)
  }
  const [countRow] = (await countQuery) as [{ value: number | string } | undefined]
  return Number(countRow?.value ?? 0)
}

function buildFindDocsQuery(
  executor: DbExecutor,
  table: DynamicTable,
  whereSql: SQL | undefined,
  sort: string | SortItem[] | undefined,
  safeLimit: number,
  offset: number,
) {
  const query = executor.select().from(table)
  if (whereSql) {
    query.where(whereSql)
  }
  const orderByList = resolveOrderBy(table, sort)
  if (orderByList.length > 0) {
    query.orderBy(...orderByList)
  }
  if (safeLimit > 0) {
    query.limit(safeLimit).offset(offset)
  }
  return query
}

async function findDocs(
  executor: DbExecutor,
  caches: AdapterCaches,
  { collection, limit, page, sort, where }: FindArgs,
): Promise<PaginatedDocs> {
  try {
    const table = getTable(caches, collection)
    const junctionTables = getJunctionTables(caches, collection)
    const safeLimit = computeSafeLimit(limit, collection.pagination?.maxLimit)
    const safePage = Math.max(1, page)
    const offset = (safePage - 1) * safeLimit
    const whereSql = resolveWhere(collection, table, junctionTables, where)

    const totalDocs = await countMatchingDocs(executor, table, whereSql)
    const totalPages = safeLimit === 0 ? 1 : Math.ceil(totalDocs / safeLimit)

    const query = buildFindDocsQuery(executor, table, whereSql, sort, safeLimit, offset)
    const rows = (await query) as Record<string, unknown>[]
    const docs = rows.map((r) => toStoredDoc(r, collection.fields))
    await populateHasManyRelations(executor, caches, collection, docs)
    return {
      docs,
      totalDocs,
      limit: safeLimit,
      page: safePage,
      totalPages,
    }
  } catch (err) {
    handleDatabaseError(err, toErrorContext(collection))
  }
}

async function findGlobalDoc(
  executor: DbExecutor,
  caches: AdapterCaches,
  global: GlobalConfig,
): Promise<StoredDoc | null> {
  try {
    const table = getGlobalTable(caches, global)
    const [row] = (await executor.select().from(table).limit(1)) as [
      Record<string, unknown> | undefined,
    ]
    return row ? toStoredDoc(row, global.fields) : null
  } catch (err) {
    handleDatabaseError(err, toErrorContext(global))
  }
}

async function updateGlobalDoc(
  executor: DbExecutor,
  caches: AdapterCaches,
  global: GlobalConfig,
  data: DocumentData,
): Promise<StoredDoc> {
  try {
    return await executor.transaction(async (tx) => {
      const table = getGlobalTable(caches, global)
      const existing = await findGlobalDoc(tx, caches, global)
      const values = sanitizeData(global, data)

      if (existing) {
        const setValues = values as unknown as UpdateSetValues
        await tx
          .update(table)
          .set(setValues)
          .where(eq(table.id, Number(existing.id)))
      } else {
        const insertValues = values as unknown as InsertValues
        await tx.insert(table).values(insertValues)
      }

      const updated = await findGlobalDoc(tx, caches, global)
      if (!updated) {
        throw new Error(`Failed to retrieve global "${global.slug}".`)
      }
      return updated
    })
  } catch (err) {
    handleDatabaseError(err, toErrorContext(global))
  }
}

function createDatabaseOperations(
  executor: DbExecutor,
  caches: AdapterCaches,
  authAdapter?: unknown,
): DatabaseAdapter {
  return {
    name: 'mysql',
    authAdapter,
    find: (args) => findDocs(executor, caches, args),
    findByID: ({ collection, id }) => findDocByID(executor, caches, collection, id),
    create: ({ collection, data }) => createDoc(executor, caches, collection, data),
    update: ({ collection, id, data }) => updateDoc(executor, caches, collection, id, data),
    delete: ({ collection, id }) => removeDoc(executor, caches, collection, id),
    findGlobal: ({ global }) => findGlobalDoc(executor, caches, global),
    updateGlobal: ({ global, data }) => updateGlobalDoc(executor, caches, global, data),
    async transaction<T>(cb: (txDb: DatabaseAdapter) => Promise<T>): Promise<T> {
      try {
        return await executor.transaction(async (tx) => {
          const txOps = createDatabaseOperations(tx, caches, authAdapter)
          return await cb(txOps)
        })
      } catch (err) {
        handleDatabaseError(err)
      }
    },
    toSchemaFile(config: Config): string {
      return generateSchemaFile(config)
    },
    migrate(): Promise<void> {
      return Promise.reject(new Error('Cannot run migrations inside a transaction'))
    },
  }
}

export function mysqlAdapter(options: MysqlAdapterOptions): MysqlAdapter {
  const pool = mysql.createPool({ uri: options.url, timezone: 'Z' })
  const db = drizzle(pool, { schema: authTables, mode: 'default' })
  const authAdapter = drizzleAdapter(db, {
    provider: 'mysql',
    schema: authTables,
  })
  const caches: AdapterCaches = {
    tableCache: new Map(),
    junctionTablesCache: new Map(),
  }
  const ops = createDatabaseOperations(db, caches, authAdapter)

  return {
    ...ops,
    async migrate({ migrationsDir }: { migrationsDir: string }): Promise<void> {
      await migrate(db, { migrationsFolder: migrationsDir })
    },
    async close(): Promise<void> {
      await pool.end()
    },
  }
}
