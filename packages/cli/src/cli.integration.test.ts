import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collection, fields as f, type DatabaseAdapter } from '@lontar/core'
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

const tagsCollection = collection({
  slug: 'tags',
  fields: {
    name: f.text({ required: true }),
  },
})

const postsCollectionLocPre = collection({
  slug: 'posts',
  fields: {
    title: f.text({ required: true }),
    slug: f.slug({ from: 'title', required: true, unique: true }),
    seo: f.group({
      fields: {
        metaTitle: f.text(),
      },
    }),
    tags: f.relationship({ relationTo: 'tags', hasMany: true }),
    gallery: f.array({
      fields: {
        caption: f.text(),
      },
    }),
  },
})

const postsCollectionLocPost = collection({
  slug: 'posts',
  fields: {
    title: f.text({ required: true, localized: true }),
    slug: f.slug({ from: 'title', required: true, unique: true, localized: true }),
    seo: f.group({
      fields: {
        metaTitle: f.text({ localized: true }),
      },
    }),
    tags: f.relationship({ relationTo: 'tags', hasMany: true, localized: true }),
    gallery: f.array({
      fields: {
        caption: f.text({ localized: true }),
      },
    }),
  },
})

const postsCollectionLocToggled = collection({
  slug: 'posts',
  fields: {
    title: f.text({ required: true }),
    slug: f.slug({ from: 'title', required: true, unique: true, localized: true }),
    seo: f.group({
      fields: {
        metaTitle: f.text({ localized: true }),
      },
    }),
    tags: f.relationship({ relationTo: 'tags', hasMany: true, localized: true }),
    gallery: f.array({
      fields: {
        caption: f.text({ localized: true }),
      },
    }),
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

function writeLocalizationConfigFile(
  tempDir: string,
  adapterImport: string,
  adapterCall: string,
  stage: 'pre' | 'localized' | 'toggled',
): void {
  const isPostgres = adapterImport === 'postgresAdapter'
  const adapterPackage = isPostgres ? '@lontar/db-postgres' : '@lontar/db-mysql'

  let locConfig: string
  let postFields: string

  if (stage === 'pre') {
    locConfig = ''
    postFields = `
        title: f.text({ required: true }),
        slug: f.slug({ from: 'title', required: true, unique: true }),
        seo: f.group({
          fields: {
            metaTitle: f.text(),
          },
        }),
        tags: f.relationship({ relationTo: 'tags', hasMany: true }),
        gallery: f.array({
          fields: {
            caption: f.text(),
          },
        }),`
  } else if (stage === 'localized') {
    locConfig = `
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'id', label: 'Indonesian' },
    ],
    defaultLocale: 'en',
  },`
    postFields = `
        title: f.text({ required: true, localized: true }),
        slug: f.slug({ from: 'title', required: true, unique: true, localized: true }),
        seo: f.group({
          fields: {
            metaTitle: f.text({ localized: true }),
          },
        }),
        tags: f.relationship({ relationTo: 'tags', hasMany: true, localized: true }),
        gallery: f.array({
          fields: {
            caption: f.text({ localized: true }),
          },
        }),`
  } else {
    locConfig = `
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'id', label: 'Indonesian' },
    ],
    defaultLocale: 'en',
  },`
    postFields = `
        title: f.text({ required: true }),
        slug: f.slug({ from: 'title', required: true, unique: true, localized: true }),
        seo: f.group({
          fields: {
            metaTitle: f.text({ localized: true }),
          },
        }),
        tags: f.relationship({ relationTo: 'tags', hasMany: true, localized: true }),
        gallery: f.array({
          fields: {
            caption: f.text({ localized: true }),
          },
        }),`
  }

  const configSource = `import { defineConfig, collection, fields as f } from '@lontar/core'
import { ${adapterImport} } from '${adapterPackage}'

export default defineConfig({
  secret: 'integration-test-secret',${locConfig}
  db: ${adapterCall},
  collections: [
    collection({
      slug: 'tags',
      fields: {
        name: f.text({ required: true }),
      },
    }),
    collection({
      slug: 'posts',
      fields: {${postFields}
      },
    }),
  ],
})
`
  fs.writeFileSync(path.join(tempDir, 'lontar.config.ts'), configSource, 'utf-8')
}

type ClosableAdapter = DatabaseAdapter & { close(): Promise<void> }

async function seedLocalizationTestData(
  db: ClosableAdapter,
): Promise<{ postId: number; tagId: number }> {
  try {
    const tag = await db.create({
      collection: tagsCollection,
      data: { name: 'Technology' },
    })
    const tagId = Number(tag['id'])
    const post = await db.create({
      collection: postsCollectionLocPre,
      data: {
        title: 'Initial Post Title',
        slug: 'initial-post-title',
        seo: { metaTitle: 'Initial SEO Title' },
        tags: [tagId],
        gallery: [{ caption: 'Initial Photo Caption' }],
      },
    })
    return { postId: Number(post['id']), tagId }
  } finally {
    await db.close()
  }
}

async function verifyPreservedLocalizedData(
  db: ClosableAdapter,
  postId: number,
  tagId: number,
): Promise<void> {
  try {
    const docEn = await db.findByID({
      collection: postsCollectionLocPost,
      id: postId,
      locale: 'en',
    })
    expect(docEn).toBeDefined()
    expect(docEn?.['title']).toBe('Initial Post Title')
    expect(docEn?.['slug']).toBe('initial-post-title')
    const seo = docEn?.['seo'] as { metaTitle?: string } | undefined
    expect(seo?.metaTitle).toBe('Initial SEO Title')
    expect(docEn?.['tags']).toEqual([tagId])
    const gallery = docEn?.['gallery'] as Array<{ caption?: string }> | undefined
    expect(gallery?.[0]?.caption).toBe('Initial Photo Caption')

    const docId = await db.findByID({
      collection: postsCollectionLocPost,
      id: postId,
      locale: 'id',
    })
    expect(docId?.['title']).toBe('Initial Post Title')
  } finally {
    await db.close()
  }
}

async function verifyPreservedToggledData(db: ClosableAdapter, postId: number): Promise<void> {
  try {
    const docToggled = await db.findByID({
      collection: postsCollectionLocToggled,
      id: postId,
      locale: 'en',
    })
    expect(docToggled).toBeDefined()
    expect(docToggled?.['title']).toBe('Initial Post Title')
    expect(docToggled?.['slug']).toBe('initial-post-title')
    const seo = docToggled?.['seo'] as { metaTitle?: string } | undefined
    expect(seo?.metaTitle).toBe('Initial SEO Title')
  } finally {
    await db.close()
  }
}

// Each test shells out to drizzle-kit twice and applies two migrations; the 5s default is too tight.
const MIGRATION_TEST_TIMEOUT_MS = 60_000

const mysqlAvailable = await isMySqlAvailable()
const postgresAvailable = await isPostgresAvailable()

describe('CLI migrate:create + migrate integration (MySQL) (#308)', () => {
  if (!mysqlAvailable) {
    if (process.env.CI) {
      throw new Error('MySQL is not reachable in CI. CLI MySQL integration test cannot run.')
    }
    it.skip('skipped because MySQL server is not reachable', () => {})
    return
  }

  it(
    'runs initial and incremental migrations against MySQL',
    async () => {
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
    },
    MIGRATION_TEST_TIMEOUT_MS,
  )

  it(
    'preserves existing data when enabling localization and toggling localized fields on MySQL (#426)',
    async () => {
      let testDb: MySqlTestDb | undefined
      const tempDir = fs.mkdtempSync(path.join(import.meta.dirname, '../.tmp-cli-test-mysql-loc-'))

      try {
        testDb = await setupMySqlTestDb()
        writeLocalizationConfigFile(
          tempDir,
          'mysqlAdapter',
          `mysqlAdapter({ url: '${testDb.url}' })`,
          'pre',
        )

        await migrateCreate({ cwd: tempDir, name: 'initial' })
        await migrate({ cwd: tempDir })

        const { postId, tagId } = await seedLocalizationTestData(mysqlAdapter({ url: testDb.url }))

        writeLocalizationConfigFile(
          tempDir,
          'mysqlAdapter',
          `mysqlAdapter({ url: '${testDb.url}', localization: { defaultLocale: 'en', locales: ['en', 'id'] } })`,
          'localized',
        )
        await migrateCreate({ cwd: tempDir, name: 'enable-localization' })
        await migrate({ cwd: tempDir })

        await verifyPreservedLocalizedData(
          mysqlAdapter({
            url: testDb.url,
            localization: { defaultLocale: 'en', locales: ['en', 'id'] },
          }),
          postId,
          tagId,
        )

        writeLocalizationConfigFile(
          tempDir,
          'mysqlAdapter',
          `mysqlAdapter({ url: '${testDb.url}', localization: { defaultLocale: 'en', locales: ['en', 'id'] } })`,
          'toggled',
        )
        await migrateCreate({ cwd: tempDir, name: 'toggle-unlocalized' })
        await migrate({ cwd: tempDir })

        await verifyPreservedToggledData(
          mysqlAdapter({
            url: testDb.url,
            localization: { defaultLocale: 'en', locales: ['en', 'id'] },
          }),
          postId,
        )
      } finally {
        if (testDb) {
          await testDb.teardown()
        }
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    },
    MIGRATION_TEST_TIMEOUT_MS * 2,
  )
})

describe('CLI migrate:create + migrate integration (PostgreSQL) (#308)', () => {
  if (!postgresAvailable) {
    if (process.env.CI) {
      throw new Error(
        'PostgreSQL is not reachable in CI. CLI PostgreSQL integration test cannot run.',
      )
    }
    it.skip('skipped because PostgreSQL server is not reachable', () => {})
    return
  }

  it(
    'runs initial and incremental migrations against PostgreSQL',
    async () => {
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
        writeConfigFile(
          tempDir,
          'postgresAdapter',
          `postgresAdapter({ url: '${testDb.url}' })`,
          true,
        )
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
    },
    MIGRATION_TEST_TIMEOUT_MS,
  )

  it(
    'preserves existing data when enabling localization and toggling localized fields on PostgreSQL (#426)',
    async () => {
      let testDb: PostgresTestDb | undefined
      const tempDir = fs.mkdtempSync(
        path.join(import.meta.dirname, '../.tmp-cli-test-postgres-loc-'),
      )

      try {
        testDb = await setupPostgresTestDb()
        writeLocalizationConfigFile(
          tempDir,
          'postgresAdapter',
          `postgresAdapter({ url: '${testDb.url}' })`,
          'pre',
        )

        await migrateCreate({ cwd: tempDir, name: 'initial' })
        await migrate({ cwd: tempDir })

        const { postId, tagId } = await seedLocalizationTestData(
          postgresAdapter({ url: testDb.url }),
        )

        writeLocalizationConfigFile(
          tempDir,
          'postgresAdapter',
          `postgresAdapter({ url: '${testDb.url}', localization: { defaultLocale: 'en', locales: ['en', 'id'] } })`,
          'localized',
        )
        await migrateCreate({ cwd: tempDir, name: 'enable-localization' })
        await migrate({ cwd: tempDir })

        await verifyPreservedLocalizedData(
          postgresAdapter({
            url: testDb.url,
            localization: { defaultLocale: 'en', locales: ['en', 'id'] },
          }),
          postId,
          tagId,
        )

        writeLocalizationConfigFile(
          tempDir,
          'postgresAdapter',
          `postgresAdapter({ url: '${testDb.url}', localization: { defaultLocale: 'en', locales: ['en', 'id'] } })`,
          'toggled',
        )
        await migrateCreate({ cwd: tempDir, name: 'toggle-unlocalized' })
        await migrate({ cwd: tempDir })

        await verifyPreservedToggledData(
          postgresAdapter({
            url: testDb.url,
            localization: { defaultLocale: 'en', locales: ['en', 'id'] },
          }),
          postId,
        )
      } finally {
        if (testDb) {
          await testDb.teardown()
        }
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    },
    MIGRATION_TEST_TIMEOUT_MS * 2,
  )
})
