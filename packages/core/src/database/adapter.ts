import type { SystemFields } from '../client/system-fields'
import type { CollectionConfig, Config } from '../config/types'
import type { SortItem, Where } from '../query/types'

/** Field values keyed by field name, as written by create and update. */
export type DocumentData = Record<string, unknown>

/** A document as read back from the database: system fields plus field values. */
export interface StoredDoc extends SystemFields {
  [field: string]: unknown
}

export interface FindArgs {
  collection: CollectionConfig
  /** Page size. */
  limit: number
  /** 1-based. */
  page: number
  /** Sort string or parsed SortItem[] */
  sort?: string | SortItem[]
  /** Filter conditions */
  where?: Where
}

export interface PaginatedDocs<T = StoredDoc> {
  docs: T[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
}

/**
 * Everything core needs from a database. Core never imports Drizzle; each
 * database package implements this. See docs/adr/0002-drizzle-mysql-adapter.md.
 *
 * Runtime methods receive the collection config on every call, so an adapter
 * never holds a copy of the config that could go stale.
 */
export interface DatabaseAdapter {
  /** e.g. `mysql`. Used in error messages and CLI output. */
  readonly name: string
  /** Underlying adapter for Better Auth (e.g. drizzleAdapter). */
  readonly authAdapter?: unknown

  // Runtime: called while serving requests.
  find(args: FindArgs): Promise<PaginatedDocs>
  findByID(args: { collection: CollectionConfig; id: number }): Promise<StoredDoc | null>
  create(args: { collection: CollectionConfig; data: DocumentData }): Promise<StoredDoc>
  update(args: {
    collection: CollectionConfig
    id: number
    data: DocumentData
  }): Promise<StoredDoc | null>
  delete(args: { collection: CollectionConfig; id: number }): Promise<StoredDoc | null>

  // Build-time: called only by the CLI, never during a request.
  toSchemaFile(config: Config): string
  migrate(args: { migrationsDir: string }): Promise<void>
}
