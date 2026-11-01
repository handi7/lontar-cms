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
  type SQL,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import mysql from 'mysql2/promise'
import {
  parseSort,
  type CollectionConfig,
  type Config,
  type DatabaseAdapter,
  type DocumentData,
  type Fields,
  type FilterOperator,
  type FindArgs,
  type GlobalConfig,
  type PaginatedDocs,
  type SortItem,
  type StoredDoc,
  type Where,
} from '@lontar/core'
import { authTables } from './schema/auth'
import { generateSchemaFile } from './schema/generator'
import { collectionToTable, globalToTable, type DynamicTable } from './schema/table'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'

export interface MysqlAdapterOptions {
  url: string
}

export type MysqlAdapter = DatabaseAdapter & {
  close(): Promise<void>
}

type InsertValues = Parameters<ReturnType<ReturnType<typeof drizzle>['insert']>['values']>[0]
type UpdateSetValues = Parameters<ReturnType<ReturnType<typeof drizzle>['update']>['set']>[0]

function toStoredDoc(row: Record<string, unknown>): StoredDoc {
  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      converted[key] = value.toISOString()
    } else {
      converted[key] = value
    }
  }
  return {
    ...converted,
    id: Number(row.id),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}

function sanitizeDate(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value === 'string') return new Date(value)
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

function sanitizeFieldValue(
  field: CollectionConfig['fields'][string] | undefined,
  value: unknown,
): unknown {
  if (field?.type === 'date') return sanitizeDate(value)
  if (field?.type === 'richText') return sanitizeRichText(value)
  return value
}

function sanitizeData(schema: { fields: Fields }, data: DocumentData): DocumentData {
  const clean: DocumentData = {}
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
      clean[key] = sanitizeFieldValue(schema.fields[key], value)
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
  if (field.type === 'number') {
    const num = Number(value)
    return Number.isNaN(num) ? value : num
  }
  if (field.type === 'date') {
    return typeof value === 'string' ? new Date(value) : value
  }
  if (field.type === 'checkbox') {
    return castCheckbox(value)
  }
  return value
}

function castFieldValue(collection: CollectionConfig, fieldName: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  const sysVal = castSystemField(fieldName, value)
  if (sysVal !== undefined) return sysVal
  return castConfigField(collection.fields[fieldName], value)
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

function parseFieldConditions(
  collection: CollectionConfig,
  table: DynamicTable,
  fieldName: string,
  filter: unknown,
): SQL[] {
  const column = table[fieldName]
  if (!column) return []

  if (filter === null || typeof filter !== 'object') {
    const val = castFieldValue(collection, fieldName, filter)
    return [eq(column, val)]
  }

  const conditions: SQL[] = []
  for (const [op, rawVal] of Object.entries(filter as Record<string, unknown>)) {
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

function resolveLogicalGroup(
  collection: CollectionConfig,
  table: DynamicTable,
  group: Where[],
  combiner: (...conditions: SQL[]) => SQL | undefined,
): SQL | undefined {
  const clauses = group
    .map((subWhere) => resolveWhere(collection, table, subWhere))
    .filter((c): c is SQL => Boolean(c))
  return clauses.length > 0 ? combiner(...clauses) : undefined
}

function resolveWhereEntry(
  collection: CollectionConfig,
  table: DynamicTable,
  key: string,
  val: unknown,
): SQL | SQL[] | undefined {
  if (key === 'or' && Array.isArray(val)) {
    return resolveLogicalGroup(collection, table, val as Where[], or)
  }
  if (key === 'and' && Array.isArray(val)) {
    return resolveLogicalGroup(collection, table, val as Where[], and)
  }
  return parseFieldConditions(collection, table, key, val)
}

function resolveWhere(
  collection: CollectionConfig,
  table: DynamicTable,
  where?: Where,
): SQL | undefined {
  if (!where || typeof where !== 'object') return undefined

  const clauses: SQL[] = []
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue
    const resolved = resolveWhereEntry(collection, table, key, val)
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
    const column = table[item.field]
    if (column) {
      orderByList.push(item.direction === 'desc' ? desc(column) : asc(column))
    }
  }
  return orderByList
}

export function mysqlAdapter(options: MysqlAdapterOptions): MysqlAdapter {
  const pool = mysql.createPool(options.url)
  const db = drizzle(pool, { schema: authTables, mode: 'default' })
  const authAdapter = drizzleAdapter(db, {
    provider: 'mysql',
    schema: authTables,
  })
  const tableCache = new Map<string, DynamicTable>()

  function getTable(collection: CollectionConfig): DynamicTable {
    let table = tableCache.get(collection.slug)
    if (!table) {
      table = collectionToTable(collection)
      tableCache.set(collection.slug, table)
    }
    return table
  }

  async function findByID({
    collection,
    id,
  }: {
    collection: CollectionConfig
    id: number
  }): Promise<StoredDoc | null> {
    const table = getTable(collection)
    const [row] = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as [
      Record<string, unknown> | undefined,
    ]
    return row ? toStoredDoc(row) : null
  }

  async function create({
    collection,
    data,
  }: {
    collection: CollectionConfig
    data: DocumentData
  }): Promise<StoredDoc> {
    const table = getTable(collection)
    const values = sanitizeData(collection, data) as unknown as InsertValues
    const [result] = (await db.insert(table).values(values)) as unknown as [mysql.ResultSetHeader]
    const id = result.insertId
    const created = await findByID({ collection, id })
    if (!created) {
      throw new Error(`Failed to retrieve created document in collection "${collection.slug}".`)
    }
    return created
  }

  async function update({
    collection,
    id,
    data,
  }: {
    collection: CollectionConfig
    id: number
    data: DocumentData
  }): Promise<StoredDoc | null> {
    const existing = await findByID({ collection, id })
    if (!existing) return null

    const table = getTable(collection)
    const values = {
      ...sanitizeData(collection, data),
      updatedAt: new Date(),
    } as unknown as UpdateSetValues
    await db.update(table).set(values).where(eq(table.id, id))
    return findByID({ collection, id })
  }

  async function remove({
    collection,
    id,
  }: {
    collection: CollectionConfig
    id: number
  }): Promise<StoredDoc | null> {
    const existing = await findByID({ collection, id })
    if (!existing) return null

    const table = getTable(collection)
    await db.delete(table).where(eq(table.id, id))
    return existing
  }

  async function find({ collection, limit, page, sort, where }: FindArgs): Promise<PaginatedDocs> {
    const table = getTable(collection)
    const safeLimit = Math.max(1, limit)
    const safePage = Math.max(1, page)
    const offset = (safePage - 1) * safeLimit
    const whereSql = resolveWhere(collection, table, where)

    const countQuery = db.select({ value: count() }).from(table)
    if (whereSql) {
      countQuery.where(whereSql)
    }
    const [countRow] = (await countQuery) as [{ value: number | string } | undefined]
    const totalDocs = Number(countRow?.value ?? 0)
    const totalPages = Math.ceil(totalDocs / safeLimit)

    const query = db.select().from(table).limit(safeLimit).offset(offset)
    if (whereSql) {
      query.where(whereSql)
    }
    const orderByList = resolveOrderBy(table, sort)
    if (orderByList.length > 0) {
      query.orderBy(...orderByList)
    }

    const rows = (await query) as Record<string, unknown>[]
    return {
      docs: rows.map(toStoredDoc),
      totalDocs,
      limit: safeLimit,
      page: safePage,
      totalPages,
    }
  }

  function getGlobalTable(global: GlobalConfig): DynamicTable {
    let table = tableCache.get(global.slug)
    if (!table) {
      table = globalToTable(global)
      tableCache.set(global.slug, table)
    }
    return table
  }

  async function findGlobal({ global }: { global: GlobalConfig }): Promise<StoredDoc | null> {
    const table = getGlobalTable(global)
    const [row] = (await db.select().from(table).limit(1)) as [Record<string, unknown> | undefined]
    return row ? toStoredDoc(row) : null
  }

  async function updateGlobal({
    global,
    data,
  }: {
    global: GlobalConfig
    data: DocumentData
  }): Promise<StoredDoc> {
    const table = getGlobalTable(global)
    const existing = await findGlobal({ global })
    const values = sanitizeData(global, data)

    if (existing) {
      const setValues = values as unknown as UpdateSetValues
      await db
        .update(table)
        .set(setValues)
        .where(eq(table.id, Number(existing.id)))
    } else {
      const insertValues = values as unknown as InsertValues
      await db.insert(table).values(insertValues)
    }

    const updated = await findGlobal({ global })
    if (!updated) {
      throw new Error(`Failed to retrieve global "${global.slug}".`)
    }
    return updated
  }

  return {
    name: 'mysql',
    authAdapter,
    find,
    findByID,
    create,
    update,
    delete: remove,
    findGlobal,
    updateGlobal,
    toSchemaFile(config: Config): string {
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
