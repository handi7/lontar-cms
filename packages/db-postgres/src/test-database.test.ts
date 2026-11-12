import { describe, expect, it } from 'vitest'
import pg from 'pg'
import { setupTestDatabase } from './test-database'

describe('setupTestDatabase', () => {
  it('returns a TestDatabase handle with url, dbName, and teardown', async () => {
    const testDb = await setupTestDatabase()

    expect(testDb.url).toContain('lontar_test')
    expect(testDb.dbName).toMatch(/lontar_test/)
    expect(typeof testDb.teardown).toBe('function')

    await testDb.teardown()
  })

  it('respects TEST_POSTGRES_URL environment variable if provided', async () => {
    const originalEnv = process.env.TEST_POSTGRES_URL
    process.env.TEST_POSTGRES_URL = 'postgres://lontar:lontar@127.0.0.1:5432/custom_test_env'

    try {
      const testDb = await setupTestDatabase()
      expect(testDb.url).toContain('custom_test_env')
      await testDb.teardown()
    } finally {
      if (originalEnv) {
        process.env.TEST_POSTGRES_URL = originalEnv
      } else {
        delete process.env.TEST_POSTGRES_URL
      }
    }
  })

  it('can create and drop isolated database when live postgres server is available', async () => {
    const url =
      process.env.TEST_POSTGRES_URL || 'postgres://lontar:lontar@127.0.0.1:5432/lontar_test'

    // Check if we can connect to administrative database
    const adminUrl = new URL(url)
    adminUrl.pathname = '/postgres'
    const probe = new pg.Client({ connectionString: adminUrl.toString() })
    let canConnect = false
    try {
      await probe.connect()
      canConnect = true
      await probe.end()
    } catch {
      // cannot connect
    }

    if (!canConnect) {
      // Postgres container not yet provisioned in docker-compose (#309); skip live assertion
      return
    }

    const testDb = await setupTestDatabase()
    expect(testDb.dbName).toMatch(/^lontar_test_[a-f0-9]+$/)

    // Verify database exists and we can connect to it
    const client = new pg.Client({ connectionString: testDb.url })
    await client.connect()
    await client.query('CREATE TABLE ping_check (id SERIAL PRIMARY KEY)')
    const res = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'ping_check'",
    )
    expect(res.rows).toHaveLength(1)
    await client.end()

    // Teardown should drop the database
    await testDb.teardown()

    // Verify database no longer exists
    const checkClient = new pg.Client({ connectionString: adminUrl.toString() })
    await checkClient.connect()
    const dbRes = await checkClient.query('SELECT datname FROM pg_database WHERE datname = $1', [
      testDb.dbName,
    ])
    expect(dbRes.rows).toHaveLength(0)
    await checkClient.end()
  })
})
