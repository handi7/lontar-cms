import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import type { Config, DatabaseAdapter } from '@lontar/core'
import { authTables } from './schema/auth'
import { generateSchemaFile } from './schema/generator'

export interface PostgresAdapterOptions {
  url: string
  pool?: {
    max?: number
    idleTimeoutMillis?: number
    connectionTimeoutMillis?: number
  }
}

export type PostgresAdapter = DatabaseAdapter & {
  close(): Promise<void>
}

export function postgresAdapter(options: PostgresAdapterOptions): PostgresAdapter {
  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.pool?.max,
    idleTimeoutMillis: options.pool?.idleTimeoutMillis,
    connectionTimeoutMillis: options.pool?.connectionTimeoutMillis,
  })

  const db = drizzle(pool, { schema: authTables })
  const authAdapter = drizzleAdapter(db, {
    provider: 'pg',
    schema: authTables,
  })

  const notImplemented = () => Promise.reject(new Error('Not implemented yet'))

  return {
    name: 'postgres',
    dialect: 'postgresql',
    authAdapter,
    find: notImplemented,
    findByID: notImplemented,
    create: notImplemented,
    update: notImplemented,
    delete: notImplemented,
    findGlobal: notImplemented,
    updateGlobal: notImplemented,
    saveVersion: notImplemented,
    findVersions: notImplemented,
    findVersionByID: notImplemented,
    findLatestDraftVersion: notImplemented,
    pruneVersions: notImplemented,
    hasVersionWithFilename: notImplemented,
    transaction: notImplemented,
    toSchemaFile(config: Config): string {
      return generateSchemaFile(config)
    },
    async migrate(): Promise<void> {
      return Promise.reject(new Error('Migrations not implemented yet'))
    },
    async close(): Promise<void> {
      await pool.end()
    },
  }
}
