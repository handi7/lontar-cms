import pg from 'pg'
import { describe, it } from 'vitest'
import { registerAdapterConformanceSuite } from '@lontar/db-test-suite'
import { postgresAdapter } from './adapter'
import { isPostgresAvailable, setupTestDatabase } from './test-database'

const postgresAvailable = await isPostgresAvailable()

if (!postgresAvailable) {
  describe.skip('postgresAdapter (integration)', () => {
    it('skipped because PostgreSQL server is not reachable', () => {})
  })
} else {
  registerAdapterConformanceSuite({
    name: 'postgresAdapter',
    label: 'Postgres adapter',
    dialect: 'postgresql',
    createAdapter: (url) => postgresAdapter({ url }),
    setupTestDatabase,
    queryRaw: async (url, query, params) => {
      const sqlQuery = typeof query === 'string' ? query : query.postgresql
      const pool = new pg.Pool({ connectionString: url })
      try {
        const res = await pool.query(sqlQuery, params)
        return res.rows as Array<Record<string, unknown>>
      } finally {
        await pool.end()
      }
    },
  })
}
