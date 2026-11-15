import pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { CollectionConfig } from '@lontar/core'
import { postgresAdapter } from './adapter'
import { isPostgresAvailable, setupTestDatabase } from './test-database'

const postgresAvailable = await isPostgresAvailable()

if (!postgresAvailable) {
  if (process.env.CI) {
    throw new Error('PostgreSQL is not reachable in CI. Integration tests cannot run.')
  }
  describe.skip('postgresAdapter pool (integration)', () => {
    it('skipped because PostgreSQL server is not reachable', () => {})
  })
} else {
  describe('postgresAdapter pool (integration)', () => {
    const testCollection: CollectionConfig = {
      slug: 'items',
      fields: {
        name: { type: 'text' },
      },
    }

    async function createItemsTable(url: string): Promise<void> {
      const client = new pg.Client({ connectionString: url })
      await client.connect()
      try {
        await client.query(`
          CREATE TABLE items (
            id SERIAL PRIMARY KEY,
            name TEXT,
            "createdAt" TIMESTAMPTZ(3) DEFAULT NOW() NOT NULL,
            "updatedAt" TIMESTAMPTZ(3) DEFAULT NOW() NOT NULL
          );
        `)
      } finally {
        await client.end()
      }
    }

    it('invokes onPoolError when an idle client connection is terminated and recovers', async () => {
      const testDb = await setupTestDatabase()
      await createItemsTable(testDb.url)
      const errors: Error[] = []

      const adapter = postgresAdapter({
        url: testDb.url,
        onPoolError: (err) => {
          errors.push(err)
        },
      })

      try {
        // 1. Warm up a connection in the pool
        const created = await adapter.create({
          collection: testCollection,
          data: { name: 'first' },
        })
        expect(created.id).toBeDefined()

        // 2. Kill the idle pooled connection using an independent client
        const killer = new pg.Client({ connectionString: testDb.url })
        await killer.connect()
        try {
          await killer.query(
            `
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()
          `,
            [testDb.dbName],
          )
        } finally {
          await killer.end()
        }

        // 3. Wait for the pool to receive the socket termination error
        for (let i = 0; i < 50 && errors.length === 0; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }

        expect(errors.length).toBeGreaterThan(0)
        const poolError = errors[0] as Error & { code?: string }
        expect(poolError.message).toMatch(/terminating connection/i)

        // 4. Verify subsequent queries on the adapter succeed with a fresh connection
        const found = await adapter.find({
          collection: testCollection,
          where: { name: { equals: 'first' } },
          limit: 10,
          page: 1,
        })
        expect(found.docs).toHaveLength(1)
        expect(found.docs[0]?.name).toBe('first')
      } finally {
        await adapter.close()
        await testDb.teardown()
      }
    })

    it('logs to console.error when onPoolError is not provided and recovers', async () => {
      const testDb = await setupTestDatabase()
      await createItemsTable(testDb.url)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const adapter = postgresAdapter({
        url: testDb.url,
      })

      try {
        // 1. Warm up connection
        const created = await adapter.create({
          collection: testCollection,
          data: { name: 'logged' },
        })
        expect(created.id).toBeDefined()

        // 2. Kill idle connection
        const killer = new pg.Client({ connectionString: testDb.url })
        await killer.connect()
        try {
          await killer.query(
            `
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()
          `,
            [testDb.dbName],
          )
        } finally {
          await killer.end()
        }

        // 3. Wait for console.error to be called
        for (let i = 0; i < 50 && consoleSpy.mock.calls.length === 0; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[lontar] Unexpected error on idle Postgres client:'),
          expect.anything(),
        )

        // 4. Verify subsequent queries succeed
        const found = await adapter.find({
          collection: testCollection,
          where: { name: { equals: 'logged' } },
          limit: 10,
          page: 1,
        })
        expect(found.docs).toHaveLength(1)
        expect(found.docs[0]?.name).toBe('logged')
      } finally {
        consoleSpy.mockRestore()
        await adapter.close()
        await testDb.teardown()
      }
    })
  })
}
