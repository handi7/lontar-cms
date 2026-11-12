export {
  DatabaseError,
  UniqueConstraintError,
  type ValidationErrorResponse,
  formatUniqueConstraintError,
} from './errors'
import type { DocStatus, SystemFields } from '../client/system-fields'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type { SortItem, Where } from '../query/types'

/** Field values keyed by field name, as written by create and update. */
export type DocumentData = Record<string, unknown>

/** A document as read back from the database: system fields plus field values. */
export interface StoredDoc extends SystemFields {
  [field: string]: unknown
}

export interface StoredVersion {
  id: number
  parentId: number
  versionNumber: number
  snapshot: DocumentData
  _status: DocStatus
  autosave: boolean
  createdAt: string
  createdBy: string | null
}

export interface SaveVersionArgs {
  collection?: CollectionConfig
  global?: GlobalConfig
  parentId?: number
  snapshot: DocumentData
  status: DocStatus
  autosave?: boolean
  userId?: string | null
}

export interface FindVersionsArgs {
  collection?: CollectionConfig
  global?: GlobalConfig
  parentId?: number
  page?: number
  limit?: number
  sort?: string | SortItem[]
}

export interface PaginatedVersions<T = StoredVersion> {
  docs: T[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
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
  /**
   * If true, ignores the collection's `pagination.maxLimit` ceiling.
   * Used for internal engine queries such as depth population batch fetching.
   */
  overrideLimit?: boolean
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
 * database package implements this. See docs/adr/0002-drizzle-mysql-adapter.md
 * and docs/adr/0025-postgres-adapter.md.
 *
 * Runtime methods receive the collection config on every call, so an adapter
 * never holds a copy of the config that could go stale.
 */
export interface DatabaseAdapter {
  /** Human-readable adapter name, e.g. 'mysql' or 'postgres'. Used in error messages and logs. */
  readonly name: string
  /** Drizzle Kit dialect identifier: 'mysql' | 'postgresql' | 'sqlite'. */
  readonly dialect?: 'mysql' | 'postgresql' | 'sqlite'
  /** Optional maximum VARCHAR length supported by the database engine. */
  readonly maxStringLength?: number
  /** Underlying adapter for Better Auth (e.g. drizzleAdapter). */
  readonly authAdapter?: unknown

  // Runtime: called while serving requests.
  find(args: FindArgs): Promise<PaginatedDocs>
  findByID(args: {
    collection: CollectionConfig
    id: number
    forUpdate?: boolean
  }): Promise<StoredDoc | null>
  create(args: { collection: CollectionConfig; data: DocumentData }): Promise<StoredDoc>
  update(args: {
    collection: CollectionConfig
    id: number
    data: DocumentData
  }): Promise<StoredDoc | null>
  delete(args: { collection: CollectionConfig; id: number }): Promise<StoredDoc | null>

  findGlobal(args: {
    global: GlobalConfig
    draft?: boolean
    forUpdate?: boolean
  }): Promise<StoredDoc | null>
  updateGlobal(args: { global: GlobalConfig; data: DocumentData }): Promise<StoredDoc>

  // Version history (when versions are enabled)
  saveVersion?(args: SaveVersionArgs): Promise<StoredVersion>
  findVersions?(args: FindVersionsArgs): Promise<PaginatedVersions>
  findVersionByID?(args: {
    collection?: CollectionConfig
    global?: GlobalConfig
    parentId?: number
    versionId: number
  }): Promise<StoredVersion | null>
  findLatestDraftVersion?(args: {
    collection?: CollectionConfig
    global?: GlobalConfig
    parentId?: number
  }): Promise<StoredVersion | null>
  pruneVersions?(args: {
    collection?: CollectionConfig
    global?: GlobalConfig
    parentId?: number
    maxPerDoc: number
  }): Promise<number>
  hasVersionWithFilename?(args: {
    collection: CollectionConfig
    filename: string
  }): Promise<boolean>

  /**
   * Run operations within a database transaction.
   * If cb throws, the transaction must be rolled back.
   */
  transaction?<T>(cb: (txDb: DatabaseAdapter) => Promise<T>): Promise<T>

  // Build-time: called only by the CLI, never during a request.
  toSchemaFile(config: Config): string
  migrate(args: { migrationsDir: string }): Promise<void>
}
