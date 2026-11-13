import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collection, fields as f } from '@lontar/core'
import {
  isMySqlAvailable,
  mysqlAdapter,
  setupTestDatabase as setupMySqlTestDb,
  type TestDatabase as MySqlTestDb,
} from '@lontar/db-mysql'
import {
  isPostgresAvailable,
  postgresAdapter,
  setupTestDatabase as setupPostgresTestDb,
  type TestDatabase as PostgresTestDb,
} from '@lontar/db-postgres'
import { migrate } from './commands/migrate'
import { migrateCreate } from './commands/migrate-create'

const postsCollectionInitial = collection({
  slug: 'posts',
  fields: {
    title: f.text({ required: true }),
  },
})

const postsCollectionWithSummary = collection({
  slug: 'posts',
  fields: {
    title: f.text({ required: true }),
    summary: f.text(),
  },
})

function writeConfigFile(
  tempDir: string,
  adapterImport: string,
  adapterCall: string,
  includeSummary: boolean,
): void {
  const summaryField = includeSummary ? ',\n        summary: f.text()' : ''
  const configSource = `import { defineConfig, collection, fields as f } from '@lontar/core'
import { ${adapterImport} } from '${adapterImport === 'mysqlAdapter' ? '@lontar/db-mysql' : '@lontar/db-postgres'}'

export default defineConfig({
  secret: 'integration-test-secret',
  db: ${adapterCall},
  collections: [
    collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true })${summaryField}
      },
    }),
  ],
})
`
  fs.writeFileSync(path.join(tempDir, 'lontar.config.ts'), configSource, 'utf-8')
}

const mysqlAvailable = await isMySqlAvailable()
const postgresAvailable = await isPostgresAvailable()

describe('CLI migrate:create + migrate integration (MySQL) (#308)', () => {
  if (!mysqlAvailable) {
    it.skip('skipped because MySQL server is not reachable', () => {})
    return
  }

  it('runs initial and incremental migrations against MySQL', async () => {
    let testDb: MySqlTestDb | undefined
    const tempDir = fs.mkdtempSync(path.join(import.meta.dirname, '../.tmp-cli-test-mysql-'))

    try {
      testDb = await setupMySqlTestDb()
      writeConfigFile(tempDir, 'mysqlAdapter', `mysqlAdapter({ url: '${testDb.url}' })`, false)

      // Step 1: Initial migration
      await migrateCreate({ cwd: tempDir, name: 'initial' })
      const migrationsDir = path.join(tempDir, 'migrations')
      expect(fs.existsSync(migrationsDir)).toBe(true)

      const filesAfterFirst = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
      expect(filesAfterFirst).toHaveLength(1)
      expect(filesAfterFirst[0]).toContain('initial')

      const firstSql = fs.readFileSync(path.join(migrationsDir, filesAfterFirst[0]!), 'utf-8')
      expect(firstSql).toContain('CREATE TABLE')
      expect(firstSql).toContain('`posts`')

      // Step 2: Apply initial migration
      await migrate({ cwd: tempDir })

      // Verify table exists by inserting a record
      const db1 = mysqlAdapter({ url: testDb.url })
      try {
        const created = await db1.create({
          collection: postsCollectionInitial,
          data: { title: 'First Post' },
        })
        expect(created.id).toBeDefined()
        expect(created.title).toBe('First Post')
      } finally {
        await db1.close()
      }

      // Step 3: Second migration adding a field
      writeConfigFile(tempDir, 'mysqlAdapter', `mysqlAdapter({ url: '${testDb.url}' })`, true)
      await migrateCreate({ cwd: tempDir, name: 'add-summary' })

      const filesAfterSecond = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
      expect(filesAfterSecond).toHaveLength(2)

      const secondFile = filesAfterSecond.find((f) => f.includes('add-summary'))
      expect(secondFile).toBeDefined()
      const secondSql = fs.readFileSync(path.join(migrationsDir, secondFile!), 'utf-8')
      expect(secondSql).toContain('ALTER TABLE `posts` ADD `summary`')

      // Step 4: Apply second migration
      await migrate({ cwd: tempDir })

      // Verify the new column is active
      const db2 = mysqlAdapter({ url: testDb.url })
      try {
        const created2 = await db2.create({
          collection: postsCollectionWithSummary,
          data: { title: 'Second Post', summary: 'MySQL summary' },
        })
        expect(created2.id).toBeDefined()
        expect(created2.title).toBe('Second Post')
        expect(created2.summary).toBe('MySQL summary')
      } finally {
        await db2.close()
      }
    } finally {
      if (testDb) {
        await testDb.teardown()
      }
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('CLI migrate:create + migrate integration (PostgreSQL) (#308)', () => {
  if (!postgresAvailable) {
    it.skip('skipped because PostgreSQL server is not reachable', () => {})
    return
  }

  it('runs initial and incremental migrations against PostgreSQL', async () => {
    let testDb: PostgresTestDb | undefined
    const tempDir = fs.mkdtempSync(path.join(import.meta.dirname, '../.tmp-cli-test-postgres-'))

    try {
      testDb = await setupPostgresTestDb()
      writeConfigFile(
        tempDir,
        'postgresAdapter',
        `postgresAdapter({ url: '${testDb.url}' })`,
        false,
      )

      // Step 1: Initial migration
      await migrateCreate({ cwd: tempDir, name: 'initial' })
      const migrationsDir = path.join(tempDir, 'migrations')
      expect(fs.existsSync(migrationsDir)).toBe(true)

      const filesAfterFirst = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
      expect(filesAfterFirst).toHaveLength(1)
      expect(filesAfterFirst[0]).toContain('initial')

      const firstSql = fs.readFileSync(path.join(migrationsDir, filesAfterFirst[0]!), 'utf-8')
      expect(firstSql).toContain('CREATE TABLE')
      expect(firstSql).toContain('"posts"')

      // Step 2: Apply initial migration
      await migrate({ cwd: tempDir })

      // Verify table exists by inserting a record
      const db1 = postgresAdapter({ url: testDb.url })
      try {
        const created = await db1.create({
          collection: postsCollectionInitial,
          data: { title: 'First Post' },
        })
        expect(created.id).toBeDefined()
        expect(created.title).toBe('First Post')
      } finally {
        await db1.close()
      }

      // Step 3: Second migration adding a field
      writeConfigFile(tempDir, 'postgresAdapter', `postgresAdapter({ url: '${testDb.url}' })`, true)
      await migrateCreate({ cwd: tempDir, name: 'add-summary' })

      const filesAfterSecond = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
      expect(filesAfterSecond).toHaveLength(2)

      const secondFile = filesAfterSecond.find((f) => f.includes('add-summary'))
      expect(secondFile).toBeDefined()
      const secondSql = fs.readFileSync(path.join(migrationsDir, secondFile!), 'utf-8')
      expect(secondSql).toContain('ALTER TABLE "posts" ADD COLUMN "summary"')

      // Step 4: Apply second migration
      await migrate({ cwd: tempDir })

      // Verify the new column is active
      const db2 = postgresAdapter({ url: testDb.url })
      try {
        const created2 = await db2.create({
          collection: postsCollectionWithSummary,
          data: { title: 'Second Post', summary: 'Postgres summary' },
        })
        expect(created2.id).toBeDefined()
        expect(created2.title).toBe('Second Post')
        expect(created2.summary).toBe('Postgres summary')
      } finally {
        await db2.close()
      }
    } finally {
      if (testDb) {
        await testDb.teardown()
      }
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
