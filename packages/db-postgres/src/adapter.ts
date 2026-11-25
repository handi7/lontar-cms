import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  not,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { PgColumn } from 'drizzle-orm/pg-core'
import pg from 'pg'
import {
  DEFAULT_LIMIT,
  DEFAULT_MAX_PER_DOC,
  generateRowId,
  parseSort,
  type ArrayField,
  type Block,
  type BlocksField,
  type CollectionConfig,
  type Config,
  type DatabaseAdapter,
  type DocStatus,
  type DocumentData,
  type Field,
  type Fields,
  type FindArgs,
  type FindVersionsArgs,
  type GlobalConfig,
  type GroupField,
  type LocalizationConfig,
  type PaginatedDocs,
  type PaginatedVersions,
  type SaveVersionArgs,
  type SortItem,
  type StoredDoc,
  type StoredVersion,
  type Where,
} from '@lontar/core'
import { authTables } from './schema/auth'
import { generateSchemaFile } from './schema/generator'
import { handleDatabaseError, toErrorContext } from './errors'
import {
  collectionToTable,
  createVersionsTable,
  flattenGroupFields,
  getCollectionJunctionTables,
  getLocaleCodes,
  globalToTable,
  type DynamicTable,
  type JunctionTable,
  type VersionsTable,
} from './schema/table'
import {
  flattenPointValue,
  projectStoredDoc,
  resolveLocaleContext,
  sanitizeDataWithLocale,
  type ResolvedLocaleContext,
} from './localization'

export interface PostgresAdapterOptions {
  url: string
  pool?: pg.PoolConfig
  onPoolError?: (err: Error, client?: pg.PoolClient) => void
  localization?: LocalizationConfig
}

export type PostgresAdapter = DatabaseAdapter & {
  close(): Promise<void>
}

type AdapterDb = NodePgDatabase<typeof authTables>
type TransactionCallback = Parameters<AdapterDb['transaction']>[0]
type AdapterTx = Parameters<TransactionCallback>[0]
type DbExecutor = AdapterDb | AdapterTx

type InsertValues = Parameters<ReturnType<AdapterDb['insert']>['values']>[0]
type UpdateSetValues = Parameters<ReturnType<AdapterDb['update']>['set']>[0]

function unflattenPointField(
  row: Record<string, unknown>,
  prefix: string,
): [number, number] | null {
  const lng = row[`${prefix}__lng`]
  const lat = row[`${prefix}__lat`]
  if ((lng === null || lng === undefined) && (lat === null || lat === undefined)) {
    return null
  }
  return [Number(lng), Number(lat)]
}

function unflattenSubField(
  row: Record<string, unknown>,
  colName: string,
  subField: Field,
): { value: unknown; hasValue: boolean } {
  if (subField.type === 'group') {
    const nested = unflattenGroupField(row, colName, subField)
    return { value: nested, hasValue: nested !== null }
  }
  if (subField.type === 'point') {
    const pt = unflattenPointField(row, colName)
    return { value: pt, hasValue: pt !== null }
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
    } else if (field.type === 'point') {
      result[fieldName] = unflattenPointField(doc, fieldName)
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

function sanitizeRelationship(
  field: CollectionConfig['fields'][string] | undefined,
  value: unknown,
): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (field?.type === 'relationship' && field.hasMany) {
    if (Array.isArray(value)) {
      return value.map((v) => Number(v)).filter((n) => !Number.isNaN(n))
    }
    return []
  }
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

function parseJsonArray(value: unknown): unknown[] | null {
  if (value === '' || value === null || value === undefined) return null
  let arr: unknown = value
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr) as unknown
    } catch {
      return null
    }
  }
  return Array.isArray(arr) ? arr : null
}

function sanitizeArrayField(field: ArrayField, value: unknown): unknown {
  const arr = parseJsonArray(value)
  if (!arr) return null
  return arr.map((item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const record = { ...(item as Record<string, unknown>) }
    if (!record.id) {
      record.id = generateRowId()
    }
    for (const [subKey, subField] of Object.entries(field.fields)) {
      if (subKey in record) {
        record[subKey] = sanitizeFieldValue(subField, record[subKey])
      }
    }
    return record
  })
}

function sanitizeBlocksField(field: BlocksField, value: unknown): unknown {
  const arr = parseJsonArray(value)
  if (!arr) return null
  return arr.map((item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const record = { ...(item as Record<string, unknown>) }
    if (!record.id) {
      record.id = generateRowId()
    }
    const blockDef = field.blocks.find((b) => b.slug === record.blockType)
    if (blockDef) {
      for (const [subKey, subField] of Object.entries(blockDef.fields)) {
        if (subKey in record) {
          record[subKey] = sanitizeFieldValue(subField, record[subKey])
        }
      }
    }
    return record
  })
}

function sanitizeGroupField(field: GroupField, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = { ...(value as Record<string, unknown>) }
  for (const [subKey, subField] of Object.entries(field.fields)) {
    if (subKey in record) {
      record[subKey] = sanitizeFieldValue(subField, record[subKey])
    }
  }
  return record
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
      return sanitizeRelationship(field, value)
    case 'array':
      return sanitizeArrayField(field, value)
    case 'blocks':
      return sanitizeBlocksField(field, value)
    case 'group':
      return sanitizeGroupField(field, value)
    default:
      return value
  }
}

function flattenSubFieldValue(
  subField: Field,
  subVal: unknown,
  fullCol: string,
): Record<string, unknown> | null {
  if (subField.type === 'group') {
    return flattenGroupValue(subField, subVal, fullCol)
  }
  if (subField.type === 'point') {
    return flattenPointValue(subVal, fullCol)
  }
  if (!(subField.type === 'relationship' && subField.hasMany)) {
    return { [fullCol]: sanitizeFieldValue(subField, subVal) }
  }
  return null
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
    const flattened = flattenSubFieldValue(subField, subVal, `${colName}__${subKey}`)
    if (flattened) {
      Object.assign(result, flattened)
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
  } else if (field?.type === 'point') {
    Object.assign(clean, flattenPointValue(value, key))
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
  if (fieldName === '_status') {
    return typeof value === 'string' ? value : String(value)
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
  if ((field.type === 'number' && !field.hasMany) || field.type === 'relationship') {
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

function resolvePointStep(parts: string[], i: number): ResolveStepResult | null {
  const next = parts[i + 1]
  if (next === 'lng' || next === 'longitude' || next === 'lat' || next === 'latitude') {
    return { done: true, field: { type: 'number', name: next } as unknown as Field }
  }
  return null
}

function resolveStep(f: Field, parts: string[], i: number): ResolveStepResult {
  if (i === parts.length - 1) {
    return { done: true, field: f }
  }
  if (f.type === 'point') {
    const pointResult = resolvePointStep(parts, i)
    if (pointResult) return pointResult
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

function checkStepLocalized(
  f: Field,
  parts: string[],
  i: number,
): { isLocalized: boolean; nextFields?: Fields; skipCount?: number } {
  const isLoc = Boolean(f.localized)
  if (i === parts.length - 1) {
    return { isLocalized: isLoc }
  }
  if (f.type === 'group' || f.type === 'array') {
    return { isLocalized: isLoc, nextFields: f.fields, skipCount: 0 }
  }
  if (f.type === 'blocks') {
    const blockDef = f.blocks.find((b) => b.slug === parts[i + 1])
    return {
      isLocalized: isLoc,
      nextFields: blockDef?.fields,
      skipCount: blockDef ? 1 : 0,
    }
  }
  return { isLocalized: isLoc }
}

function isPathLocalized(fields: Fields, fieldPath: string): boolean {
  const parts = fieldPath.includes('.') ? fieldPath.split('.') : fieldPath.split('__')
  let currentFields: Fields = fields
  let inheritedLocalized = false

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) return inheritedLocalized
    const f: Field | undefined = currentFields[part]
    if (!f) return inheritedLocalized

    const step = checkStepLocalized(f, parts, i)
    if (step.isLocalized) inheritedLocalized = true
    if (!step.nextFields) {
      return inheritedLocalized
    }
    currentFields = step.nextFields
    i += step.skipCount ?? 0
  }
  return inheritedLocalized
}

function castFieldValue(collection: CollectionConfig, fieldName: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  const sysVal = castSystemField(fieldName, value)
  if (sysVal !== undefined) return sysVal
  const field = resolveField(collection.fields, fieldName)
  return castConfigField(field, value)
}

function buildInCondition(column: PgColumn, operator: string, value: unknown): SQL | undefined {
  if (operator === 'in') {
    const arr = Array.isArray(value) ? value : [value]
    return arr.length > 0 ? inArray(column, arr) : undefined
  }
  if (operator === 'not_in') {
    const arr = Array.isArray(value) ? value : [value]
    return arr.length > 0 ? notInArray(column, arr) : undefined
  }
  return undefined
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function buildNullCondition(column: PgColumn, operator: string): SQL | undefined {
  if (operator === 'equals') return isNull(column)
  if (operator === 'not_equals') return isNotNull(column)
  return undefined
}

function buildBasicCondition(column: PgColumn, operator: string, value: unknown): SQL | undefined {
  if (value === null) {
    return buildNullCondition(column, operator)
  }
  switch (operator) {
    case 'equals':
      return eq(column, value)
    case 'not_equals':
      return ne(column, value)
    case 'like':
      return ilike(column, toPatternString(value))
    case 'contains':
      return ilike(column, `%${escapeLikeWildcards(toPatternString(value))}%`)
    case 'exists':
      return value ? isNotNull(column) : isNull(column)
    default:
      return buildInCondition(column, operator, value)
  }
}

function buildComparisonCondition(
  column: PgColumn,
  operator: string,
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

function buildCondition(column: PgColumn, operator: string, value: unknown): SQL | undefined {
  return (
    buildBasicCondition(column, operator, value) ??
    buildComparisonCondition(column, operator, value)
  )
}

function resolveJunctionLocaleFilter(
  junctionTable: JunctionTable,
  localeCtx?: ResolvedLocaleContext,
): SQL {
  if (!junctionTable._locale) return sql``
  const loc =
    localeCtx?.requestedLocale && !localeCtx.isAll
      ? localeCtx.requestedLocale
      : localeCtx?.defaultLocale
  return loc ? sql` AND ${junctionTable._locale} = ${loc}` : sql``
}

function buildHasManyEquals(
  table: DynamicTable,
  junctionTable: JunctionTable,
  val: unknown,
  locFilter: SQL,
  isNot = false,
): SQL | undefined {
  const id = Number(val)
  if (Number.isNaN(id)) return undefined
  return isNot
    ? sql`${table.id} NOT IN (SELECT ${junctionTable.parentId} FROM ${junctionTable} WHERE ${junctionTable.targetId} = ${id}${locFilter})`
    : sql`${table.id} IN (SELECT ${junctionTable.parentId} FROM ${junctionTable} WHERE ${junctionTable.targetId} = ${id}${locFilter})`
}

function buildHasManyIn(
  table: DynamicTable,
  junctionTable: JunctionTable,
  val: unknown,
  locFilter: SQL,
): SQL | undefined {
  const arr = Array.isArray(val) ? val : [val]
  const ids = arr.map(Number).filter((n) => !Number.isNaN(n))
  return ids.length > 0
    ? sql`${table.id} IN (SELECT ${junctionTable.parentId} FROM ${junctionTable} WHERE ${inArray(junctionTable.targetId, ids)}${locFilter})`
    : undefined
}

function parseHasManyOpCondition(
  table: DynamicTable,
  junctionTable: JunctionTable,
  op: string,
  val: unknown,
  localeCtx?: ResolvedLocaleContext,
): SQL | undefined {
  if (val === undefined || val === null) return undefined
  const locFilter = resolveJunctionLocaleFilter(junctionTable, localeCtx)

  if (op === 'equals') return buildHasManyEquals(table, junctionTable, val, locFilter, false)
  if (op === 'not_equals') return buildHasManyEquals(table, junctionTable, val, locFilter, true)
  if (op === 'in') return buildHasManyIn(table, junctionTable, val, locFilter)
  return undefined
}

function parseHasManyConditions(
  table: DynamicTable,
  junctionTable: JunctionTable | undefined,
  filter: unknown,
  localeCtx?: ResolvedLocaleContext,
): SQL[] {
  if (!junctionTable) return []
  if (filter === null || typeof filter !== 'object') {
    const cond = parseHasManyOpCondition(table, junctionTable, 'equals', filter, localeCtx)
    return cond ? [cond] : []
  }

  const conditions: SQL[] = []
  for (const [op, rawVal] of Object.entries(filter as Record<string, unknown>)) {
    const cond = parseHasManyOpCondition(table, junctionTable, op, rawVal, localeCtx)
    if (cond) conditions.push(cond)
  }
  return conditions
}

function parseObjectFilterConditions(
  collection: CollectionConfig,
  column: PgColumn,
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

    const cond = buildCondition(column, op, val)
    if (cond) conditions.push(cond)
  }
  return conditions
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
  localeCtx?: ResolvedLocaleContext,
): SQL[] {
  const conditions: SQL[] = []
  for (const [subName, subVal] of Object.entries(filter)) {
    if (subVal === undefined) continue
    const nestedPath = `${fieldName}.${subName}`
    conditions.push(
      ...parseFieldConditions(collection, table, junctionTables, nestedPath, subVal, localeCtx),
    )
  }
  return conditions
}

function parseStandardColumnConditions(
  collection: CollectionConfig,
  column: PgColumn,
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

interface JsonPathInfo {
  jsonPath: string
  blockType?: string
  subSegments: string[]
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

function buildJsonCandidate(pathInfo: JsonPathInfo, value: unknown): Record<string, unknown> {
  if (pathInfo.blockType) {
    return buildBlockCandidate(pathInfo.blockType, pathInfo.subSegments, value)
  }
  return buildNestedCandidate(pathInfo.subSegments, value)
}

function buildJsonInCondition(
  column: PgColumn,
  pathInfo: JsonPathInfo,
  rawVal: unknown,
): SQL | undefined {
  const arr = Array.isArray(rawVal) ? rawVal : [rawVal]
  if (arr.length === 0) return undefined
  const items = arr.map((v) => {
    const candidate = buildJsonCandidate(pathInfo, v)
    return sql`${column} @> ${JSON.stringify([candidate])}::jsonb`
  })
  return sql`(${column} IS NOT NULL AND jsonb_typeof(${column}) = 'array' AND (${sql.join(items, sql` OR `)}))`
}

function buildJsonTextPatternCondition(
  column: PgColumn,
  pathInfo: JsonPathInfo,
  pattern: string,
): SQL | undefined {
  if (pathInfo.subSegments.length === 0) return undefined
  const pathSegments = pathInfo.subSegments.map((s) => sql`${s}`)
  const whereClause = pathInfo.blockType
    ? sql`elem->>'blockType' = ${pathInfo.blockType} AND jsonb_extract_path_text(elem, ${sql.join(pathSegments, sql`, `)}) ILIKE ${pattern}`
    : sql`jsonb_extract_path_text(elem, ${sql.join(pathSegments, sql`, `)}) ILIKE ${pattern}`

  return sql`(${column} IS NOT NULL AND jsonb_typeof(${column}) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(${column}) AS elem WHERE ${whereClause}))`
}

function toPatternString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function buildJsonEqualityCondition(
  column: PgColumn,
  pathInfo: JsonPathInfo,
  op: string,
  rawVal: unknown,
): SQL | undefined {
  if (op === 'equals') {
    const candidate = buildJsonCandidate(pathInfo, rawVal)
    return sql`(${column} IS NOT NULL AND jsonb_typeof(${column}) = 'array' AND ${column} @> ${JSON.stringify([candidate])}::jsonb)`
  }
  if (op === 'not_equals') {
    const candidate = buildJsonCandidate(pathInfo, rawVal)
    return sql`(${column} IS NULL OR jsonb_typeof(${column}) != 'array' OR NOT (${column} @> ${JSON.stringify([candidate])}::jsonb))`
  }
  return undefined
}

function buildJsonOpCondition(
  column: PgColumn,
  pathInfo: JsonPathInfo,
  op: string,
  rawVal: unknown,
): SQL | undefined {
  if (rawVal === undefined) return undefined
  const equality = buildJsonEqualityCondition(column, pathInfo, op, rawVal)
  if (equality) return equality
  if (op === 'in') return buildJsonInCondition(column, pathInfo, rawVal)
  if (op === 'contains') {
    return buildJsonTextPatternCondition(
      column,
      pathInfo,
      `%${escapeLikeWildcards(toPatternString(rawVal))}%`,
    )
  }
  if (op === 'like') {
    return buildJsonTextPatternCondition(column, pathInfo, toPatternString(rawVal))
  }
  return undefined
}

function parseJsonArrayConditions(
  column: PgColumn,
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
  return fieldName.split(/\.|__/)[0] ?? fieldName
}

function resolveTargetLocale(localeCtx?: ResolvedLocaleContext): string | undefined {
  return localeCtx?.requestedLocale && !localeCtx.isAll
    ? localeCtx.requestedLocale
    : localeCtx?.defaultLocale
}

function resolveJsonArrayColumn(
  table: DynamicTable,
  topKey: string,
  topField: Field,
  loc?: string,
): PgColumn | undefined {
  const topColName = topField.localized && loc ? `${topKey}_${loc}` : topKey
  if (!Object.hasOwn(table, topColName)) return undefined
  return table[topColName]
}

function resolveSubFieldJsonPathInfo(
  collection: CollectionConfig,
  fieldName: string,
  pathInfo: JsonPathInfo,
  loc?: string,
): JsonPathInfo {
  const subField = resolveField(collection.fields, fieldName)
  if (subField?.localized && loc) {
    return {
      ...pathInfo,
      jsonPath: `${pathInfo.jsonPath}.${loc}`,
      subSegments: [...pathInfo.subSegments, loc],
    }
  }
  return pathInfo
}

interface JsonContainer {
  field: Field
  /** The field's own name, without a locale suffix. */
  baseKey: string
  /** Set when the path names a locale itself, as in `layout_en.blockType`. */
  explicitLocale?: string
}

function isJsonContainerField(field: Field | undefined): field is Field {
  return field?.type === 'array' || field?.type === 'blocks'
}

// A localized array or blocks field is queried as `<name>_<locale>`, which is a column but not a
// key in `collection.fields`. Without this the path matches nothing and the filter is dropped.
function resolveJsonContainer(
  collection: CollectionConfig,
  topKey: string,
  localeCtx?: ResolvedLocaleContext,
): JsonContainer | null {
  const direct = collection.fields[topKey]
  if (isJsonContainerField(direct)) return { field: direct, baseKey: topKey }
  for (const loc of localeCtx?.allLocales ?? []) {
    const suffix = `_${loc}`
    if (!topKey.endsWith(suffix)) continue
    const baseKey = topKey.slice(0, -suffix.length)
    const field = collection.fields[baseKey]
    if (isJsonContainerField(field) && field.localized) {
      return { field, baseKey, explicitLocale: loc }
    }
  }
  return null
}

function parseJsonFieldConditions(
  collection: CollectionConfig,
  table: DynamicTable,
  fieldName: string,
  filter: unknown,
  localeCtx?: ResolvedLocaleContext,
): SQL[] | null {
  const topKey = getTopKey(fieldName)
  if (topKey === fieldName) return null
  const container = resolveJsonContainer(collection, topKey, localeCtx)
  if (!container) return null

  const loc = container.explicitLocale ?? resolveTargetLocale(localeCtx)
  const column = resolveJsonArrayColumn(table, container.baseKey, container.field, loc)
  if (!column) return []

  const basePathInfo = resolveJsonPathInfo(container.field, fieldName, topKey)
  // A path with an explicit locale is already complete; its rows have no localized subfields.
  const pathInfo = container.explicitLocale
    ? basePathInfo
    : resolveSubFieldJsonPathInfo(collection, fieldName, basePathInfo, loc)
  return parseJsonArrayConditions(column, pathInfo, filter)
}

function normalizePointPath(fieldPath: string): string {
  return fieldPath
    .replace(/\.longitude(?=$|\.|_)/g, '.lng')
    .replace(/__longitude(?=$|\.|__|_)/g, '__lng')
    .replace(/\.latitude(?=$|\.|_)/g, '.lat')
    .replace(/__latitude(?=$|\.|__|_)/g, '__lat')
}

function resolveFilterColumnName(
  collection: CollectionConfig,
  fieldName: string,
  loc?: string,
): string {
  const normalized = normalizePointPath(fieldName)
  const baseCol = normalized.replace(/\./g, '__')
  const isLoc = isPathLocalized(collection.fields, normalized)
  return isLoc && loc ? `${baseCol}_${loc}` : baseCol
}

function isPointNullFilter(filter: unknown): boolean {
  if (filter === null) return true
  if (typeof filter === 'object' && filter !== null) {
    return (filter as Record<string, unknown>).equals === null
  }
  return false
}

function isPointNotNullFilter(filter: unknown): boolean {
  return (
    typeof filter === 'object' &&
    filter !== null &&
    (filter as Record<string, unknown>).not_equals === null
  )
}

function parsePointNullConditions(
  table: DynamicTable,
  baseColName: string,
  filter: unknown,
): SQL[] {
  const colLng = table[`${baseColName}__lng`]
  const colLat = table[`${baseColName}__lat`]
  if (!colLng || !colLat) return []

  if (isPointNullFilter(filter)) {
    const cond = and(isNull(colLng), isNull(colLat))
    return cond ? [cond] : []
  }
  if (isPointNotNullFilter(filter)) {
    const cond = and(isNotNull(colLng), isNotNull(colLat))
    return cond ? [cond] : []
  }
  return []
}

function parsePgScalarContains(column: PgColumn, val: unknown): SQL {
  return sql`(${column} IS NOT NULL AND ${column} @> ${JSON.stringify([val])}::jsonb)`
}

function parsePgScalarEquals(column: PgColumn, val: unknown): SQL {
  if (val === null) return isNull(column)
  return sql`(${column} IS NOT NULL AND ${column} = ${JSON.stringify(val)}::jsonb)`
}

function parsePgScalarIn(column: PgColumn, val: unknown): SQL | undefined {
  if (!Array.isArray(val) || val.length === 0) return sql`1=0`
  const conds = val.map((v) => parsePgScalarContains(column, v))
  return or(...conds)
}

function parsePgScalarNotIn(column: PgColumn, val: unknown): SQL | undefined {
  if (!Array.isArray(val) || val.length === 0) return undefined
  const conds = val.map((v) => parsePgScalarContains(column, v))
  const disjunction = or(...conds)
  return disjunction ? not(disjunction) : undefined
}

function parsePgScalarHasManyOp(column: PgColumn, op: string, val: unknown): SQL | undefined {
  switch (op) {
    case 'contains':
      return parsePgScalarContains(column, val)
    case 'not_contains':
      return sql`(${column} IS NULL OR NOT (${column} @> ${JSON.stringify([val])}::jsonb))`
    case 'equals':
      return parsePgScalarEquals(column, val)
    case 'not_equals':
      return val === null
        ? isNotNull(column)
        : sql`(${column} IS NULL OR ${column} != ${JSON.stringify(val)}::jsonb)`
    case 'in':
      return parsePgScalarIn(column, val)
    case 'not_in':
      return parsePgScalarNotIn(column, val)
    case 'exists':
      return val ? isNotNull(column) : isNull(column)
    default:
      return undefined
  }
}

function parseScalarHasManyConditions(column: PgColumn, filter: unknown): SQL[] {
  if (filter === null) {
    return [isNull(column)]
  }
  if (Array.isArray(filter)) {
    return [parsePgScalarEquals(column, filter)]
  }
  if (typeof filter !== 'object') {
    return [parsePgScalarContains(column, filter)]
  }
  const conds: SQL[] = []
  for (const [op, val] of Object.entries(filter as Record<string, unknown>)) {
    const cond = parsePgScalarHasManyOp(column, op, val)
    if (cond) conds.push(cond)
  }
  return conds
}

function isScalarHasMany(field?: Field): boolean {
  if (!field || !('hasMany' in field) || !field.hasMany) return false
  return field.type === 'text' || field.type === 'number'
}

function resolveScalarHasManyConditions(
  table: DynamicTable,
  colName: string,
  filter: unknown,
): SQL[] {
  const column = Object.hasOwn(table, colName) ? table[colName] : undefined
  return column ? parseScalarHasManyConditions(column, filter) : []
}

function parseSpecialFieldConditions(
  field: Field | undefined,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  colName: string,
  fieldName: string,
  filter: unknown,
  localeCtx?: ResolvedLocaleContext,
): SQL[] | null {
  if (isScalarHasMany(field)) {
    return resolveScalarHasManyConditions(table, colName, filter)
  }
  if (field?.type === 'point') {
    return parsePointNullConditions(table, colName, filter)
  }
  if (field?.type === 'relationship' && field.hasMany) {
    const jTable = junctionTables[colName] ?? junctionTables[fieldName]
    return parseHasManyConditions(table, jTable, filter, localeCtx)
  }
  return null
}

function parseFieldConditions(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  fieldName: string,
  filter: unknown,
  localeCtx?: ResolvedLocaleContext,
): SQL[] {
  const field = resolveField(collection.fields, fieldName)
  if (isContainerFilterObject(field, filter)) {
    return parseGroupConditions(collection, table, junctionTables, fieldName, filter, localeCtx)
  }

  const jsonConds = parseJsonFieldConditions(collection, table, fieldName, filter, localeCtx)
  if (jsonConds !== null) {
    return jsonConds
  }

  const colName = resolveFilterColumnName(collection, fieldName, resolveTargetLocale(localeCtx))
  const specialConds = parseSpecialFieldConditions(
    field,
    table,
    junctionTables,
    colName,
    fieldName,
    filter,
    localeCtx,
  )
  if (specialConds !== null) return specialConds

  const column = Object.hasOwn(table, colName) ? table[colName] : undefined
  if (!column) return []

  return parseStandardColumnConditions(collection, column, fieldName, filter)
}

function resolveLogicalGroup(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  group: Where[],
  combiner: (...conditions: SQL[]) => SQL | undefined,
  localeCtx?: ResolvedLocaleContext,
): SQL | undefined {
  const clauses = group
    .map((subWhere) => resolveWhere(collection, table, junctionTables, subWhere, localeCtx))
    .filter((c): c is SQL => Boolean(c))
  return clauses.length > 0 ? combiner(...clauses) : undefined
}

function resolveWhereEntry(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  key: string,
  val: unknown,
  localeCtx?: ResolvedLocaleContext,
): SQL | SQL[] | undefined {
  if (key === 'or' && Array.isArray(val)) {
    return resolveLogicalGroup(collection, table, junctionTables, val as Where[], or, localeCtx)
  }
  if (key === 'and' && Array.isArray(val)) {
    return resolveLogicalGroup(collection, table, junctionTables, val as Where[], and, localeCtx)
  }
  return parseFieldConditions(collection, table, junctionTables, key, val, localeCtx)
}

function resolveWhere(
  collection: CollectionConfig,
  table: DynamicTable,
  junctionTables: Record<string, JunctionTable>,
  where?: Where,
  localeCtx?: ResolvedLocaleContext,
): SQL | undefined {
  if (!where || typeof where !== 'object') return undefined

  const clauses: SQL[] = []
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue
    const resolved = resolveWhereEntry(collection, table, junctionTables, key, val, localeCtx)
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

function normalizeSortItems(sort?: string | SortItem[]): SortItem[] {
  if (Array.isArray(sort)) {
    return sort.filter((s): s is SortItem => typeof s === 'object' && 'field' in s)
  }
  return parseSort(sort)
}

function defaultOrderBy(table: DynamicTable): SQL[] {
  const list: SQL[] = []
  if (table.createdAt) list.push(sql`${desc(table.createdAt)} NULLS LAST`)
  if (table.id) list.push(sql`${desc(table.id)} NULLS LAST`)
  return list
}

function resolveSortColumnName(item: SortItem, collection: CollectionConfig, loc?: string): string {
  const normalized = normalizePointPath(item.field)
  const baseCol = normalized.replace(/\./g, '__')
  const isLoc = isPathLocalized(collection.fields, normalized)
  return isLoc && loc ? `${baseCol}_${loc}` : baseCol
}

function explicitOrderBy(
  table: DynamicTable,
  collection: CollectionConfig,
  sortItems: SortItem[],
  localeCtx?: ResolvedLocaleContext,
): SQL[] {
  const orderByList: SQL[] = []
  let hasId = false
  let lastDirection: 'asc' | 'desc' = 'desc'
  const loc = resolveTargetLocale(localeCtx)

  for (const item of sortItems) {
    const colName = resolveSortColumnName(item, collection, loc)
    if (colName === 'id') hasId = true
    lastDirection = item.direction
    const column = Object.hasOwn(table, colName) ? table[colName] : undefined
    if (column) {
      orderByList.push(
        item.direction === 'desc'
          ? sql`${desc(column)} NULLS LAST`
          : sql`${asc(column)} NULLS FIRST`,
      )
    }
  }

  if (!hasId && table.id) {
    orderByList.push(
      lastDirection === 'desc'
        ? sql`${desc(table.id)} NULLS LAST`
        : sql`${asc(table.id)} NULLS FIRST`,
    )
  }

  return orderByList
}

function resolveOrderBy(
  table: DynamicTable,
  collection: CollectionConfig,
  sort?: string | SortItem[],
  localeCtx?: ResolvedLocaleContext,
): SQL[] {
  const sortItems = normalizeSortItems(sort)
  if (sortItems.length === 0) {
    return defaultOrderBy(table)
  }
  return explicitOrderBy(table, collection, sortItems, localeCtx)
}

interface AdapterCaches {
  tableCache: Map<string, DynamicTable>
  junctionTablesCache: Map<string, Record<string, JunctionTable>>
  versionsTableCache: Map<string, VersionsTable>
}

function getTable(
  caches: AdapterCaches,
  collection: CollectionConfig,
  localization?: LocalizationConfig,
): DynamicTable {
  const cacheKey = `${collection.slug}:${localization ? getLocaleCodes(localization).join(',') : ''}`
  let table = caches.tableCache.get(cacheKey)
  if (!table) {
    table = collectionToTable(collection, localization)
    caches.tableCache.set(cacheKey, table)
  }
  return table
}

function getGlobalTable(
  caches: AdapterCaches,
  global: GlobalConfig,
  localization?: LocalizationConfig,
): DynamicTable {
  const cacheKey = `${global.slug}:${localization ? getLocaleCodes(localization).join(',') : ''}`
  let table = caches.tableCache.get(cacheKey)
  if (!table) {
    table = globalToTable(global, localization)
    caches.tableCache.set(cacheKey, table)
  }
  return table
}

function getEntityVersionsTable(
  caches: AdapterCaches,
  args: { collection?: CollectionConfig; global?: GlobalConfig },
  localization?: LocalizationConfig,
): VersionsTable {
  const target = args.collection ?? args.global
  if (!target) {
    throw new Error('Either collection or global must be provided to getEntityVersionsTable')
  }
  const versionsSlug = `${target.slug}_versions`
  let table = caches.versionsTableCache.get(versionsSlug)
  if (!table) {
    const parentTable = args.collection
      ? getTable(caches, args.collection, localization)
      : getGlobalTable(caches, args.global!, localization)
    const isUpload = Boolean(args.collection?.upload)
    table = createVersionsTable(target.slug, parentTable, isUpload)
    caches.versionsTableCache.set(versionsSlug, table)
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

async function syncLocalizedAllLocales(
  executor: DbExecutor,
  jTable: JunctionTable,
  parentId: number,
  targetIds: unknown,
): Promise<void> {
  if (typeof targetIds !== 'object' || targetIds === null || Array.isArray(targetIds)) {
    return
  }
  for (const [loc, ids] of Object.entries(targetIds as Record<string, unknown>)) {
    await executor
      .delete(jTable)
      .where(and(eq(jTable.parentId, parentId), eq(jTable._locale!, loc)))
    if (!Array.isArray(ids) || ids.length === 0) continue
    const rows = ids
      .map((tid, index) => ({
        parentId,
        targetId: Number(tid),
        _locale: loc,
        order: index,
      }))
      .filter((row) => !Number.isNaN(row.targetId))
    if (rows.length > 0) {
      await executor.insert(jTable).values(rows)
    }
  }
}

async function syncLocalizedSingleLocale(
  executor: DbExecutor,
  jTable: JunctionTable,
  parentId: number,
  targetIds: unknown,
  loc: string,
): Promise<void> {
  await executor.delete(jTable).where(and(eq(jTable.parentId, parentId), eq(jTable._locale!, loc)))
  if (!Array.isArray(targetIds) || targetIds.length === 0) return
  const rows = targetIds
    .map((tid, index) => ({
      parentId,
      targetId: Number(tid),
      _locale: loc,
      order: index,
    }))
    .filter((row) => !Number.isNaN(row.targetId))
  if (rows.length > 0) {
    await executor.insert(jTable).values(rows)
  }
}

async function syncLocalizedJunctionRelation(
  executor: DbExecutor,
  jTable: JunctionTable,
  parentId: number,
  targetIds: unknown,
  localeCtx: ResolvedLocaleContext,
): Promise<void> {
  if (localeCtx.isAll) {
    await syncLocalizedAllLocales(executor, jTable, parentId, targetIds)
    return
  }
  const loc = localeCtx.requestedLocale
  if (loc) {
    await syncLocalizedSingleLocale(executor, jTable, parentId, targetIds, loc)
  }
}

async function syncSingleHasManyRelation(
  executor: DbExecutor,
  jTable: JunctionTable,
  parentId: number,
  targetIds: unknown,
  localeCtx?: ResolvedLocaleContext,
): Promise<void> {
  const isLocalized = Boolean(jTable._locale)
  if (isLocalized && localeCtx) {
    await syncLocalizedJunctionRelation(executor, jTable, parentId, targetIds, localeCtx)
    return
  }

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

function setTargetRelationIds(doc: StoredDoc, fieldName: string, ids: unknown): void {
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
  localeCtx?: ResolvedLocaleContext,
): Promise<void> {
  const junctionTables = getJunctionTables(caches, collection)
  for (const [name, jTable] of Object.entries(junctionTables)) {
    const val = extractRelationData(data, name)
    if (val !== undefined) {
      await syncSingleHasManyRelation(executor, jTable, parentId, val, localeCtx)
    }
  }
}

async function populateLocalizedHasManyAll(
  executor: DbExecutor,
  jTable: JunctionTable,
  docs: StoredDoc[],
  fieldName: string,
  parentIds: number[],
  allLocales: readonly string[],
): Promise<void> {
  for (const doc of docs) {
    const dict: Record<string, number[]> = {}
    for (const loc of allLocales) {
      dict[loc] = []
    }
    setTargetRelationIds(doc, fieldName, dict)
  }
  const rows = (await executor
    .select({
      parentId: jTable.parentId,
      targetId: jTable.targetId,
      _locale: jTable._locale!,
    })
    .from(jTable)
    .where(inArray(jTable.parentId, parentIds))
    .orderBy(asc(jTable.order))) as Array<{ parentId: number; targetId: number; _locale: string }>

  for (const row of rows) {
    const doc = docs.find((d) => d.id === row.parentId)
    if (doc) {
      const dict = doc[fieldName] as Record<string, number[]> | undefined
      const list = dict?.[row._locale]
      if (Array.isArray(list)) {
        list.push(row.targetId)
      }
    }
  }
}

async function populateLocalizedHasManySingle(
  executor: DbExecutor,
  jTable: JunctionTable,
  docs: StoredDoc[],
  fieldName: string,
  parentIds: number[],
  localeCtx: ResolvedLocaleContext,
): Promise<void> {
  for (const doc of docs) {
    setTargetRelationIds(doc, fieldName, [])
  }
  const reqLocale = localeCtx.requestedLocale!
  const locsToFetch = [reqLocale]
  if (localeCtx.fallbackLocale && localeCtx.fallbackLocale !== reqLocale) {
    locsToFetch.push(localeCtx.fallbackLocale)
  }
  const rows = (await executor
    .select({
      parentId: jTable.parentId,
      targetId: jTable.targetId,
      _locale: jTable._locale!,
    })
    .from(jTable)
    .where(and(inArray(jTable.parentId, parentIds), inArray(jTable._locale!, locsToFetch)))
    .orderBy(asc(jTable.order))) as Array<{ parentId: number; targetId: number; _locale: string }>

  for (const doc of docs) {
    const reqList = rows
      .filter((r) => r.parentId === doc.id && r._locale === reqLocale)
      .map((r) => r.targetId)
    if (
      reqList.length === 0 &&
      localeCtx.fallbackLocale &&
      localeCtx.fallbackLocale !== reqLocale
    ) {
      const fbList = rows
        .filter((r) => r.parentId === doc.id && r._locale === localeCtx.fallbackLocale)
        .map((r) => r.targetId)
      setTargetRelationIds(doc, fieldName, fbList)
    } else {
      setTargetRelationIds(doc, fieldName, reqList)
    }
  }
}

async function populateStandardHasMany(
  executor: DbExecutor,
  jTable: JunctionTable,
  docs: StoredDoc[],
  fieldName: string,
  parentIds: number[],
): Promise<void> {
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

async function populateHasManyRelations(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  docs: StoredDoc[],
  localeCtx?: ResolvedLocaleContext,
): Promise<void> {
  if (docs.length === 0) return
  const junctionTables = getJunctionTables(caches, collection)
  const junctionEntries = Object.entries(junctionTables)
  if (junctionEntries.length === 0) return

  const parentIds = docs.map((d) => d.id)

  for (const [fieldName, jTable] of junctionEntries) {
    const isLocalized = Boolean(jTable._locale)
    if (!isLocalized || (!localeCtx?.requestedLocale && !localeCtx?.isAll)) {
      await populateStandardHasMany(executor, jTable, docs, fieldName, parentIds)
      continue
    }

    if (localeCtx.isAll) {
      await populateLocalizedHasManyAll(
        executor,
        jTable,
        docs,
        fieldName,
        parentIds,
        localeCtx.allLocales,
      )
    } else {
      await populateLocalizedHasManySingle(executor, jTable, docs, fieldName, parentIds, localeCtx)
    }
  }
}

async function findDocByID(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  id: number,
  forUpdate?: boolean,
  localeCtx?: ResolvedLocaleContext,
  localization?: LocalizationConfig,
): Promise<StoredDoc | null> {
  try {
    const table = getTable(caches, collection, localization)
    const baseQuery = executor.select().from(table).where(eq(table.id, id)).limit(1)
    const query = forUpdate ? baseQuery.for('update') : baseQuery
    const [row] = (await query) as [Record<string, unknown> | undefined]
    if (!row) return null
    const doc =
      localeCtx && localeCtx.allLocales.length > 0
        ? projectStoredDoc(row, collection.fields, localeCtx)
        : toStoredDoc(row, collection.fields)
    await populateHasManyRelations(executor, caches, collection, [doc], localeCtx)
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
  localeCtx?: ResolvedLocaleContext,
  localization?: LocalizationConfig,
): Promise<StoredDoc> {
  try {
    return await executor.transaction(async (tx) => {
      const table = getTable(caches, collection, localization)
      const values = (localeCtx && localeCtx.allLocales.length > 0
        ? sanitizeDataWithLocale(collection.fields, data, localeCtx)
        : sanitizeData(collection, data)) as unknown as InsertValues
      const [inserted] = (await tx
        .insert(table)
        .values(values)
        .returning({ id: table.id })) as unknown as [{ id: number }]
      const id = Number(inserted.id)
      await syncHasManyRelations(tx, caches, collection, id, data, localeCtx)
      const created = await findDocByID(tx, caches, collection, id, false, localeCtx, localization)
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
  localeCtx?: ResolvedLocaleContext,
  localization?: LocalizationConfig,
): Promise<StoredDoc | null> {
  try {
    return await executor.transaction(async (tx) => {
      const existing = await findDocByID(tx, caches, collection, id, true, undefined, localization)
      if (!existing) return null

      const table = getTable(caches, collection, localization)
      const values = {
        ...(localeCtx && localeCtx.allLocales.length > 0
          ? sanitizeDataWithLocale(collection.fields, data, localeCtx, existing)
          : sanitizeData(collection, data)),
        updatedAt: new Date(),
      } as unknown as UpdateSetValues
      await tx.update(table).set(values).where(eq(table.id, id))
      await syncHasManyRelations(tx, caches, collection, id, data, localeCtx)
      return findDocByID(tx, caches, collection, id, false, localeCtx, localization)
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
  localeCtx?: ResolvedLocaleContext,
  localization?: LocalizationConfig,
): Promise<StoredDoc | null> {
  try {
    return await executor.transaction(async (tx) => {
      const existing = await findDocByID(tx, caches, collection, id, false, localeCtx, localization)
      if (!existing) return null

      const junctionTables = getJunctionTables(caches, collection)
      for (const jTable of Object.values(junctionTables)) {
        await tx.delete(jTable).where(eq(jTable.parentId, id))
      }

      const table = getTable(caches, collection, localization)
      await tx.delete(table).where(eq(table.id, id))
      return existing
    })
  } catch (err) {
    handleDatabaseError(err, toErrorContext(collection))
  }
}

function computeSafeLimit(limit: number, maxLimit?: number, overrideLimit = false): number {
  if (limit === 0) return 0
  const positive = Math.max(1, limit)
  if (overrideLimit) return positive
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
  collection: CollectionConfig,
  localeCtx?: ResolvedLocaleContext,
) {
  const query = executor.select().from(table)
  if (whereSql) {
    query.where(whereSql)
  }
  const orderByList = resolveOrderBy(table, collection, sort, localeCtx)
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
  args: FindArgs,
  localization?: LocalizationConfig,
): Promise<PaginatedDocs> {
  try {
    const collection = args.collection
    const localeCtx = resolveLocaleContext(localization, args.locale, args.fallbackLocale)
    const table = getTable(caches, collection, localization)
    const junctionTables = getJunctionTables(caches, collection)
    const safeLimit = computeSafeLimit(
      args.limit,
      collection.pagination?.maxLimit,
      args.overrideLimit,
    )
    const safePage = Math.max(1, args.page)
    const offset = (safePage - 1) * safeLimit
    const whereSql = resolveWhere(collection, table, junctionTables, args.where, localeCtx)

    const totalDocs = await countMatchingDocs(executor, table, whereSql)
    const totalPages = safeLimit === 0 ? 1 : Math.ceil(totalDocs / safeLimit)

    const query = buildFindDocsQuery(
      executor,
      table,
      whereSql,
      args.sort,
      safeLimit,
      offset,
      collection,
      localeCtx,
    )
    const rows = (await query) as Record<string, unknown>[]
    const docs = rows.map((r) =>
      localeCtx.allLocales.length > 0
        ? projectStoredDoc(r, collection.fields, localeCtx)
        : toStoredDoc(r, collection.fields),
    )
    await populateHasManyRelations(executor, caches, collection, docs, localeCtx)
    return {
      docs,
      totalDocs,
      limit: safeLimit,
      page: safePage,
      totalPages,
    }
  } catch (err) {
    handleDatabaseError(err, toErrorContext(args.collection))
  }
}

async function findGlobalDoc(
  executor: DbExecutor,
  caches: AdapterCaches,
  global: GlobalConfig,
  forUpdate?: boolean,
  localeCtx?: ResolvedLocaleContext,
  localization?: LocalizationConfig,
): Promise<StoredDoc | null> {
  try {
    const table = getGlobalTable(caches, global, localization)
    const baseQuery = executor.select().from(table).limit(1)
    const query = forUpdate ? baseQuery.for('update') : baseQuery
    const [row] = (await query) as [Record<string, unknown> | undefined]
    if (!row) return null
    return localeCtx && localeCtx.allLocales.length > 0
      ? projectStoredDoc(row, global.fields, localeCtx)
      : toStoredDoc(row, global.fields)
  } catch (err) {
    handleDatabaseError(err, toErrorContext(global))
  }
}

async function updateGlobalDoc(
  executor: DbExecutor,
  caches: AdapterCaches,
  global: GlobalConfig,
  data: DocumentData,
  localeCtx?: ResolvedLocaleContext,
  localization?: LocalizationConfig,
): Promise<StoredDoc> {
  try {
    return await executor.transaction(async (tx) => {
      const table = getGlobalTable(caches, global, localization)
      const existing = await findGlobalDoc(tx, caches, global, true, undefined, localization)
      const values =
        localeCtx && localeCtx.allLocales.length > 0
          ? sanitizeDataWithLocale(global.fields, data, localeCtx, existing ?? undefined)
          : sanitizeData(global, data)

      if (existing) {
        const setValues = {
          ...values,
          updatedAt: new Date(),
        } as unknown as UpdateSetValues
        await tx
          .update(table)
          .set(setValues)
          .where(eq(table.id, Number(existing.id)))
      } else {
        const insertValues = values as unknown as InsertValues
        await tx.insert(table).values(insertValues)
      }

      const updated = await findGlobalDoc(tx, caches, global, false, localeCtx, localization)
      if (!updated) {
        throw new Error(`Failed to retrieve global "${global.slug}".`)
      }
      return updated
    })
  } catch (err) {
    handleDatabaseError(err, toErrorContext(global))
  }
}

function parseSnapshot(raw: unknown): DocumentData {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as DocumentData
    } catch {
      return {}
    }
  }
  return (raw as DocumentData) ?? {}
}

function rowToVersionDoc(row: Record<string, unknown>): StoredVersion {
  const createdAtVal = row.createdAt ?? row.created_at
  let createdAt: string
  if (createdAtVal instanceof Date) {
    createdAt = createdAtVal.toISOString()
  } else if (typeof createdAtVal === 'string') {
    createdAt = createdAtVal
  } else {
    createdAt = new Date().toISOString()
  }

  return {
    id: Number(row.id),
    parentId: Number(row.parentId ?? row.parent_id),
    versionNumber: Number(row.versionNumber ?? row.version_number),
    snapshot: parseSnapshot(row.snapshot),
    _status: (row._status ?? row.status ?? 'draft') as DocStatus,
    autosave: Boolean(row.autosave),
    createdAt,
    createdBy: (row.createdBy ?? row.created_by ?? null) as string | null,
  }
}

async function updateAutosaveVersion(
  executor: DbExecutor,
  vTable: VersionsTable,
  latestRow: Record<string, unknown>,
  snapshot: DocumentData,
  userId?: string | null,
): Promise<StoredVersion> {
  const versionId = Number(latestRow.id)
  await executor
    .update(vTable)
    .set({
      snapshot,
      createdAt: new Date(),
      createdBy: userId ?? null,
    })
    .where(eq(vTable.id, versionId))

  const updated = await executor.select().from(vTable).where(eq(vTable.id, versionId)).limit(1)

  const row = updated[0]
  if (!row) {
    throw new Error('Failed to retrieve updated version row')
  }
  return rowToVersionDoc(row)
}

async function tryUpdateAutosave(
  executor: DbExecutor,
  vTable: VersionsTable,
  args: SaveVersionArgs,
): Promise<StoredVersion | null> {
  if (!args.autosave || args.status !== 'draft') return null
  const latest = await executor
    .select()
    .from(vTable)
    .where(eq(vTable.parentId, args.parentId!))
    .orderBy(desc(vTable.id))
    .limit(1)

  const latestRow = latest[0]
  if (!latestRow) return null
  const isDraft = (latestRow._status ?? latestRow.status) === 'draft'
  const isAutosave = Boolean(latestRow.autosave)
  if (isDraft && isAutosave) {
    return await updateAutosaveVersion(executor, vTable, latestRow, args.snapshot, args.userId)
  }
  return null
}

async function insertNewVersion(
  executor: DbExecutor,
  vTable: VersionsTable,
  args: SaveVersionArgs,
): Promise<StoredVersion> {
  const maxVerResult = await executor
    .select({ maxVer: max(vTable.versionNumber) })
    .from(vTable)
    .where(eq(vTable.parentId, args.parentId))

  const versionNumber = (Number(maxVerResult[0]?.maxVer) || 0) + 1

  const [inserted] = (await executor
    .insert(vTable)
    .values({
      parentId: args.parentId,
      versionNumber,
      snapshot: args.snapshot,
      _status: args.status,
      autosave: Boolean(args.autosave),
      createdBy: args.userId ?? null,
    })
    .returning({ id: vTable.id })) as unknown as [{ id: number }]

  const newId = Number(inserted?.id)
  const [row] = await executor.select().from(vTable).where(eq(vTable.id, newId)).limit(1)

  if (!row) {
    throw new Error('Failed to retrieve inserted version row')
  }
  return rowToVersionDoc(row)
}

async function pruneVersionsInternal(
  executor: DbExecutor,
  vTable: VersionsTable,
  parentId: number,
  maxPerDoc: number,
): Promise<number> {
  const keepRows = await executor
    .select({ id: vTable.id })
    .from(vTable)
    .where(eq(vTable.parentId, parentId))
    .orderBy(desc(vTable.id))
    .limit(maxPerDoc)

  if (keepRows.length < maxPerDoc) return 0

  const keepIds = keepRows.map((v) => Number(v.id))
  const deleted = (await executor
    .delete(vTable)
    .where(and(eq(vTable.parentId, parentId), notInArray(vTable.id, keepIds)))
    .returning({ id: vTable.id })) as unknown as Array<{ id: number }>

  return deleted.length
}

async function saveVersion(
  executor: DbExecutor,
  caches: AdapterCaches,
  args: SaveVersionArgs,
  localization?: LocalizationConfig,
): Promise<StoredVersion> {
  const target = args.collection ?? args.global!
  const parentId = args.parentId ?? 1
  try {
    const parentTable = args.collection
      ? getTable(caches, args.collection, localization)
      : getGlobalTable(caches, args.global!, localization)

    await executor.select().from(parentTable).where(eq(parentTable.id, parentId)).for('update')

    const vTable = getEntityVersionsTable(caches, args, localization)
    const maxPerDoc = target.versions?.maxPerDoc ?? DEFAULT_MAX_PER_DOC

    const autosaveResult = await tryUpdateAutosave(executor, vTable, { ...args, parentId })
    if (autosaveResult) {
      return autosaveResult
    }

    const saved = await insertNewVersion(executor, vTable, { ...args, parentId })
    if (maxPerDoc > 0) {
      await pruneVersionsInternal(executor, vTable, parentId, maxPerDoc)
    }
    return saved
  } catch (err) {
    handleDatabaseError(err, toErrorContext(target))
  }
}

type VersionsSortColumn =
  'id' | 'parentId' | 'versionNumber' | '_status' | 'autosave' | 'createdAt' | 'createdBy'

const VERSIONS_SORT_FIELDS: Record<string, VersionsSortColumn> = {
  id: 'id',
  parentId: 'parentId',
  parent_id: 'parentId',
  versionNumber: 'versionNumber',
  version_number: 'versionNumber',
  _status: '_status',
  status: '_status',
  autosave: 'autosave',
  createdAt: 'createdAt',
  created_at: 'createdAt',
  createdBy: 'createdBy',
  created_by: 'createdBy',
}

function resolveVersionsOrderBy(vTable: VersionsTable, sort?: string | SortItem[]): SQL[] {
  const sortItems = normalizeSortItems(sort)

  if (sortItems.length === 0) {
    return [sql`${desc(vTable.id)} NULLS LAST`]
  }

  const orderByList: SQL[] = []
  let hasId = false
  let lastDirection: 'asc' | 'desc' = 'desc'

  for (const item of sortItems) {
    const colKey = VERSIONS_SORT_FIELDS[item.field]
    if (!colKey) continue
    if (colKey === 'id') hasId = true
    lastDirection = item.direction
    const column = vTable[colKey] as PgColumn | undefined
    if (column) {
      orderByList.push(
        item.direction === 'desc'
          ? sql`${desc(column)} NULLS LAST`
          : sql`${asc(column)} NULLS FIRST`,
      )
    }
  }

  if (!hasId) {
    orderByList.push(
      lastDirection === 'desc'
        ? sql`${desc(vTable.id)} NULLS LAST`
        : sql`${asc(vTable.id)} NULLS FIRST`,
    )
  }

  return orderByList
}

async function findVersions(
  executor: DbExecutor,
  caches: AdapterCaches,
  args: FindVersionsArgs,
  localization?: LocalizationConfig,
): Promise<PaginatedVersions> {
  const target = args.collection ?? args.global!
  try {
    const parentId = args.parentId ?? 1
    const vTable = getEntityVersionsTable(caches, args, localization)
    const page = Math.max(1, args.page ?? 1)
    const limit = args.limit ?? DEFAULT_LIMIT
    const offset = (page - 1) * limit

    const countResult = await executor
      .select({ count: count() })
      .from(vTable)
      .where(eq(vTable.parentId, parentId))

    const totalDocs = Number(countResult[0]?.count ?? 0)
    const totalPages = Math.ceil(totalDocs / limit) || 1

    const orderByList = resolveVersionsOrderBy(vTable, args.sort)

    const rows = await executor
      .select()
      .from(vTable)
      .where(eq(vTable.parentId, parentId))
      .orderBy(...orderByList)
      .limit(limit)
      .offset(offset)

    return {
      docs: rows.map(rowToVersionDoc),
      totalDocs,
      limit,
      page,
      totalPages,
    }
  } catch (err) {
    handleDatabaseError(err, toErrorContext(target))
  }
}

async function findVersionByID(
  executor: DbExecutor,
  caches: AdapterCaches,
  args: {
    collection?: CollectionConfig
    global?: GlobalConfig
    parentId?: number
    versionId: number
  },
  localization?: LocalizationConfig,
): Promise<StoredVersion | null> {
  const target = args.collection ?? args.global!
  try {
    const parentId = args.parentId ?? 1
    const vTable = getEntityVersionsTable(caches, args, localization)
    const rows = await executor
      .select()
      .from(vTable)
      .where(and(eq(vTable.parentId, parentId), eq(vTable.id, args.versionId)))
      .limit(1)

    const row = rows[0]
    if (!row) return null
    return rowToVersionDoc(row)
  } catch (err) {
    handleDatabaseError(err, toErrorContext(target))
  }
}

async function findLatestDraftVersion(
  executor: DbExecutor,
  caches: AdapterCaches,
  args: { collection?: CollectionConfig; global?: GlobalConfig; parentId?: number },
  localization?: LocalizationConfig,
): Promise<StoredVersion | null> {
  const target = args.collection ?? args.global!
  try {
    const parentId = args.parentId ?? 1
    const vTable = getEntityVersionsTable(caches, args, localization)
    const rows = await executor
      .select()
      .from(vTable)
      .where(eq(vTable.parentId, parentId))
      .orderBy(desc(vTable.id))
      .limit(1)

    const latest = rows[0]
    if (!latest) return null
    const status = (latest._status ?? latest.status) as DocStatus
    if (status !== 'draft') {
      return null
    }
    return rowToVersionDoc(latest)
  } catch (err) {
    handleDatabaseError(err, toErrorContext(target))
  }
}

async function hasVersionWithFilename(
  executor: DbExecutor,
  caches: AdapterCaches,
  collection: CollectionConfig,
  filename: string,
  localization?: LocalizationConfig,
): Promise<boolean> {
  try {
    const vTable = getEntityVersionsTable(caches, { collection }, localization)
    const result = await executor
      .select({ id: vTable.id })
      .from(vTable)
      .where(sql`${vTable.snapshot}->>'filename' = ${filename}`)
      .limit(1)
    return result.length > 0
  } catch (err) {
    handleDatabaseError(err, toErrorContext(collection))
  }
}

function createDatabaseOperations(
  executor: DbExecutor,
  caches: AdapterCaches,
  authAdapter?: unknown,
  getLocalization?: () => LocalizationConfig | undefined,
): DatabaseAdapter {
  return {
    name: 'postgres',
    dialect: 'postgresql',
    authAdapter,
    find: (args) => findDocs(executor, caches, args, getLocalization?.()),
    findByID: ({ collection, id, forUpdate, locale, fallbackLocale }) => {
      const locConfig = getLocalization?.()
      const localeCtx = resolveLocaleContext(locConfig, locale, fallbackLocale)
      return findDocByID(executor, caches, collection, id, forUpdate, localeCtx, locConfig)
    },
    create: ({ collection, data, locale }) => {
      const locConfig = getLocalization?.()
      const localeCtx = resolveLocaleContext(locConfig, locale)
      return createDoc(executor, caches, collection, data, localeCtx, locConfig)
    },
    update: ({ collection, id, data, locale }) => {
      const locConfig = getLocalization?.()
      const localeCtx = resolveLocaleContext(locConfig, locale)
      return updateDoc(executor, caches, collection, id, data, localeCtx, locConfig)
    },
    delete: ({ collection, id, locale }) => {
      const locConfig = getLocalization?.()
      const localeCtx = resolveLocaleContext(locConfig, locale)
      return removeDoc(executor, caches, collection, id, localeCtx, locConfig)
    },
    findGlobal: ({ global, draft: _draft, forUpdate, locale, fallbackLocale }) => {
      const locConfig = getLocalization?.()
      const localeCtx = resolveLocaleContext(locConfig, locale, fallbackLocale)
      return findGlobalDoc(executor, caches, global, forUpdate, localeCtx, locConfig)
    },
    updateGlobal: ({ global, data, locale }) => {
      const locConfig = getLocalization?.()
      const localeCtx = resolveLocaleContext(locConfig, locale)
      return updateGlobalDoc(executor, caches, global, data, localeCtx, locConfig)
    },
    saveVersion: (args) => saveVersion(executor, caches, args, getLocalization?.()),
    findVersions: (args) => findVersions(executor, caches, args, getLocalization?.()),
    findVersionByID: (args) => findVersionByID(executor, caches, args, getLocalization?.()),
    findLatestDraftVersion: (args) =>
      findLatestDraftVersion(executor, caches, args, getLocalization?.()),
    pruneVersions: (args) => {
      const target = args.collection ?? args.global!
      try {
        return pruneVersionsInternal(
          executor,
          getEntityVersionsTable(caches, args, getLocalization?.()),
          args.parentId ?? 1,
          args.maxPerDoc,
        )
      } catch (err) {
        handleDatabaseError(err, toErrorContext(target))
      }
    },
    hasVersionWithFilename: (args) =>
      hasVersionWithFilename(executor, caches, args.collection, args.filename, getLocalization?.()),
    async transaction<T>(cb: (txDb: DatabaseAdapter) => Promise<T>): Promise<T> {
      try {
        return await executor.transaction(async (tx) => {
          const txOps = createDatabaseOperations(tx, caches, authAdapter, getLocalization)
          const txAdapter: DatabaseAdapter = {
            ...txOps,
            get localization() {
              return getLocalization?.()
            },
            set localization(loc: LocalizationConfig | undefined) {
              if (getLocalization) {
                // handled by outer scope
              }
            },
          }
          return await cb(txAdapter)
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

export function buildPoolConfig(url: string, userPool?: pg.PoolConfig): pg.PoolConfig {
  const defaultOptions = '-c timezone=UTC'
  const userOptions = userPool?.options?.trim()

  let options: string
  if (!userOptions) {
    options = defaultOptions
  } else if (userOptions.includes('timezone=')) {
    options = userOptions
  } else {
    options = `${defaultOptions} ${userOptions}`
  }

  return {
    connectionString: url,
    ...userPool,
    options,
  }
}

export function postgresAdapter(options: PostgresAdapterOptions): PostgresAdapter {
  const pool = new pg.Pool(buildPoolConfig(options.url, options.pool))

  pool.on('error', (err: Error, client?: pg.PoolClient) => {
    if (options.onPoolError) {
      options.onPoolError(err, client)
    } else {
      console.error('[lontar] Unexpected error on idle Postgres client:', err)
    }
  })

  const db = drizzle(pool, { schema: authTables })
  const authAdapter = drizzleAdapter(db, {
    provider: 'pg',
    schema: authTables,
  })

  const caches: AdapterCaches = {
    tableCache: new Map(),
    junctionTablesCache: new Map(),
    versionsTableCache: new Map(),
  }

  let currentLocalization = options.localization
  const ops = createDatabaseOperations(db, caches, authAdapter, () => currentLocalization)

  return {
    ...ops,
    get localization() {
      return currentLocalization
    },
    set localization(loc: LocalizationConfig | undefined) {
      currentLocalization = loc
    },
    toSchemaFile(config: Config): string {
      if (config.localization) {
        currentLocalization = config.localization
      }
      return generateSchemaFile(config)
    },
    async migrate({ migrationsDir }: { migrationsDir: string }): Promise<void> {
      await migrate(db, { migrationsFolder: migrationsDir })
    },
    async close(): Promise<void> {
      await pool.end()
    },
  }
}
