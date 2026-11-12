import mysql from 'mysql2/promise'
import { registerAdapterConformanceSuite } from '@lontar/db-test-suite'
import { mysqlAdapter } from './adapter'
import { setupTestDatabase } from './test-database'

registerAdapterConformanceSuite({
  name: 'mysqlAdapter',
  label: 'MySQL adapter',
  dialect: 'mysql',
  createAdapter: (url) => mysqlAdapter({ url }),
  setupTestDatabase,
  queryRaw: async (url, query, params) => {
    const sql = typeof query === 'string' ? query : query.mysql
    const pool = mysql.createPool(url)
    try {
      const [rows] = await pool.query(sql, params)
      return rows as Array<Record<string, unknown>>
    } finally {
      await pool.end()
    }
  },
})
