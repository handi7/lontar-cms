import { asc, count, desc, eq, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import mysql from 'mysql2/promise'
import type {
  CollectionConfig,
  Config,
  DatabaseAdapter,
  DocumentData,
  FindArgs,
  PaginatedDocs,
  StoredDoc,
} from '@lontar/core'
import { generateSchemaFile } from './schema/generator'
import { collectionToTable, type DynamicTable } from './schema/table'

export interface MysqlAdapterOptions {
  url: string
}

export type MysqlAdapter = DatabaseAdapter & {
  close(): Promise<void>
}

type InsertValues = Parameters<ReturnType<ReturnType<typeof drizzle>['insert']>['values']>[0]
type UpdateSetValues = Parameters<ReturnType<ReturnType<typeof drizzle>['update']>['set']>[0]

function toStoredDoc(row: Record<string, unknown>): StoredDoc {
  return {
    ...row,
    id: Number(row.id),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}

function sanitizeData(data: DocumentData): DocumentData {
  const clean: DocumentData = {}
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
      clean[key] = value
    }
  }
  return clean
}

function resolveOrderBy(table: DynamicTable, sort?: string): SQL | undefined {
  if (!sort) {
    const createdAtCol = table.createdAt
    return createdAtCol ? desc(createdAtCol) : undefined
  }
  const isDesc = sort.startsWith('-')
  const fieldName = isDesc ? sort.slice(1) : sort
  const column = table[fieldName]
  if (!column) return undefined
  return isDesc ? desc(column) : asc(column)
}

export function mysqlAdapter(options: MysqlAdapterOptions): MysqlAdapter {
  const pool = mysql.createPool(options.url)
  const db = drizzle(pool)
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
    const values = sanitizeData(data) as unknown as InsertValues
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
      ...sanitizeData(data),
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

  async function find({ collection, limit, page, sort }: FindArgs): Promise<PaginatedDocs> {
    const table = getTable(collection)
    const safeLimit = Math.max(1, limit)
    const safePage = Math.max(1, page)
    const offset = (safePage - 1) * safeLimit

    const [countRow] = (await db.select({ value: count() }).from(table)) as [
      { value: number | string } | undefined,
    ]
    const totalDocs = Number(countRow?.value ?? 0)
    const totalPages = Math.ceil(totalDocs / safeLimit)

    const query = db.select().from(table).limit(safeLimit).offset(offset)
    const orderBy = resolveOrderBy(table, sort)
    if (orderBy) {
      query.orderBy(orderBy)
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

  return {
    name: 'mysql',
    find,
    findByID,
    create,
    update,
    delete: remove,
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
