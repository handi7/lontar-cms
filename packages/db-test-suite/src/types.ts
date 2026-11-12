import type { DatabaseAdapter } from '@lontar/core'

export interface TestDatabaseHandle {
  url: string
  teardown: () => Promise<void>
}

export type RawQueryParam = unknown

export interface RawQueryMapping {
  mysql: string
  postgresql: string
  sqlite?: string
}

export type RawQueryInput = string | RawQueryMapping

export interface ConformanceSuiteContext {
  /** Adapter identifier, e.g. 'mysqlAdapter' or 'postgresAdapter' */
  name: string
  /** Human-readable label, e.g. 'MySQL adapter' */
  label?: string
  /** Database dialect */
  dialect: 'mysql' | 'postgresql' | 'sqlite'
  /** Factory to construct a fresh DatabaseAdapter for a given database URL */
  createAdapter: (url: string) => DatabaseAdapter
  /** Setup isolated test database instance */
  setupTestDatabase: () => Promise<TestDatabaseHandle>
  /**
   * Optional raw query function to assert database-level state
   * (e.g. checking junction tables or ensuring rows don't linger after rollback).
   */
  queryRaw?: (
    url: string,
    query: RawQueryInput,
    params?: RawQueryParam[],
  ) => Promise<Array<Record<string, unknown>>>
}

export interface ConformanceSuiteOptions {
  /** Test titles to skip (exact match or substring match) */
  skipTests?: string[]
}
