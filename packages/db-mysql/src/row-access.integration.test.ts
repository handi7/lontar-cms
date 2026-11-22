import { describe, it } from 'vitest'
import { registerRowAccessConformanceSuite } from '@lontar/db-test-suite'
import { mysqlAdapter } from './adapter'
import { isMySqlAvailable, setupTestDatabase } from './test-database'

const mysqlAvailable = await isMySqlAvailable()

if (!mysqlAvailable) {
  if (process.env.CI) {
    throw new Error('MySQL is not reachable in CI. Integration tests cannot run.')
  }
  describe.skip('mysqlAdapter: row-level access constraints (integration)', () => {
    it('skipped because the MySQL server is not reachable', () => {})
  })
} else {
  registerRowAccessConformanceSuite({
    name: 'mysqlAdapter',
    label: 'MySQL adapter',
    dialect: 'mysql',
    createAdapter: (url) => mysqlAdapter({ url }),
    setupTestDatabase,
  })
}
