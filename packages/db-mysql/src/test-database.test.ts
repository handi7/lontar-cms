import mysql from 'mysql2/promise'
import { describe, expect, it } from 'vitest'
import { setupTestDatabase } from './test-database'

describe('setupTestDatabase', () => {
  it('creates an isolated test database and drops it on teardown', async () => {
    const testDb = await setupTestDatabase()

    expect(testDb.url).toContain('lontar_test_')
    expect(testDb.dbName).toMatch(/^lontar_test_[a-f0-9]+$/)

    // Verify database exists and we can connect to it
    const pool = mysql.createPool(testDb.url)
    await pool.query('CREATE TABLE ping_check (id INT PRIMARY KEY)')
    const [tables] = (await pool.query('SHOW TABLES')) as unknown as [
      Array<Record<string, string>>,
      unknown,
    ]
    expect(tables).toHaveLength(1)
    await pool.end()

    // Teardown should drop the database
    await testDb.teardown()

    // Verify database no longer exists
    const serverConn = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3306,
      user: 'lontar',
      password: 'lontar',
    })
    const [dbs] = (await serverConn.query('SHOW DATABASES LIKE ?', [testDb.dbName])) as unknown as [
      Array<unknown>,
      unknown,
    ]
    expect(dbs).toHaveLength(0)
    await serverConn.end()
  })

  it('respects TEST_DATABASE_URL environment variable if provided', async () => {
    const originalEnv = process.env.TEST_DATABASE_URL
    process.env.TEST_DATABASE_URL = 'mysql://lontar:lontar@127.0.0.1:3306/custom_test_env'

    try {
      const testDb = await setupTestDatabase()
      expect(testDb.dbName).toMatch(/^lontar_test_[a-f0-9]+$/)
      await testDb.teardown()
    } finally {
      if (originalEnv) {
        process.env.TEST_DATABASE_URL = originalEnv
      } else {
        delete process.env.TEST_DATABASE_URL
      }
    }
  })
})
