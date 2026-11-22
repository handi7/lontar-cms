import { describe, it } from 'vitest'
import { registerRowAccessConformanceSuite } from '@lontar/db-test-suite'
import { postgresAdapter } from './adapter'
import { isPostgresAvailable, setupTestDatabase } from './test-database'

const postgresAvailable = await isPostgresAvailable()

if (!postgresAvailable) {
  if (process.env.CI) {
    throw new Error('PostgreSQL is not reachable in CI. Integration tests cannot run.')
  }
  describe.skip('postgresAdapter: row-level access constraints (integration)', () => {
    it('skipped because PostgreSQL server is not reachable', () => {})
  })
} else {
  registerRowAccessConformanceSuite({
    name: 'postgresAdapter',
    label: 'Postgres adapter',
    dialect: 'postgresql',
    createAdapter: (url) => postgresAdapter({ url }),
    setupTestDatabase,
  })
}
