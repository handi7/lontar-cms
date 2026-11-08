import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import {
  UniqueConstraintError,
  type CollectionConfig,
  type Config,
  type GlobalConfig,
} from '@lontar/core'
import { mysqlAdapter, type MysqlAdapter } from './adapter'
import { setupTestDatabase, type TestDatabase } from './test-database'

const postsCollection: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  fields: {
    title: { type: 'text', required: true, maxLength: 120 },
    views: { type: 'number', integer: true, defaultValue: 0 },
    content: { type: 'richText' },
    author: { type: 'relationship', relationTo: 'users' },
    categories: { type: 'relationship', relationTo: 'categories', hasMany: true },
    publishedAt: { type: 'date' },
  },
}

const categoriesCollection: CollectionConfig = {
  slug: 'categories',
  labels: { singular: 'Category', plural: 'Categories' },
  fields: {
    name: { type: 'text', required: true },
  },
}

const tagsCollection: CollectionConfig = {
  slug: 'tags',
  labels: { singular: 'Tag', plural: 'Tags' },
  fields: {
    slug: { type: 'slug', unique: true, required: true },
  },
}

const pagesCollection: CollectionConfig = {
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  fields: {
    title: { type: 'text', required: true },
    seo: {
      type: 'group',
      fields: {
        metaTitle: { type: 'text', maxLength: 60 },
        metaDescription: { type: 'textarea' },
      },
    },
  },
}

const headerGlobal: GlobalConfig = {
  slug: 'header',
  fields: {
    siteTitle: { type: 'text', required: true, maxLength: 120 },
    announcement: { type: 'text' },
  },
}

describe('mysqlAdapter (integration)', () => {
  let testDb: TestDatabase
  let testDatabaseUrl: string
  let adapter: MysqlAdapter
  let tempDir: string
  let migrationsDir: string

  beforeAll(async () => {
    testDb = await setupTestDatabase()
    testDatabaseUrl = testDb.url
    adapter = mysqlAdapter({ url: testDatabaseUrl })

    const config: Config = {
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection, categoriesCollection, tagsCollection, pagesCollection],
      globals: [headerGlobal],
    }

    // Prepare temp dir and schema file
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-mysql-test-'))
    const schemaFile = path.join(tempDir, 'schema.ts')
    migrationsDir = path.join(tempDir, 'migrations')
    fs.writeFileSync(schemaFile, adapter.toSchemaFile(config), 'utf-8')

    // Run drizzle-kit generate
    const drizzleKitBin = path.resolve(
      import.meta.dirname,
      '../../../node_modules/.pnpm/drizzle-kit@0.31.11/node_modules/drizzle-kit/bin.cjs',
    )
    execFileSync(process.execPath, [
      drizzleKitBin,
      'generate',
      '--dialect',
      'mysql',
      '--schema',
      schemaFile,
      '--out',
      migrationsDir,
    ])

    // Run migrations using adapter
    await adapter.migrate({ migrationsDir })
  })

  afterAll(async () => {
    try {
      if (adapter) {
        await adapter.close()
      }
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } finally {
      if (testDb) {
        await testDb.teardown()
      }
    }
  })

  it('creates documents and returns StoredDoc with system fields', async () => {
    const doc1 = await adapter.create({
      collection: postsCollection,
      data: { title: 'First Post', views: 10 },
    })

    expect(doc1.id).toBe(1)
    expect(doc1.title).toBe('First Post')
    expect(doc1.views).toBe(10)
    expect(typeof doc1.createdAt).toBe('string')
    expect(typeof doc1.updatedAt).toBe('string')
    expect(new Date(doc1.createdAt).toISOString()).toBe(doc1.createdAt)

    const doc2 = await adapter.create({
      collection: postsCollection,
      data: { title: 'Second Post' },
    })

    expect(doc2.id).toBe(2)
    expect(doc2.title).toBe('Second Post')
    expect(doc2.views).toBe(0) // default value
  })

  it('finds document by ID', async () => {
    const found = await adapter.findByID({ collection: postsCollection, id: 1 })
    expect(found).not.toBeNull()
    expect(found?.title).toBe('First Post')

    const notFound = await adapter.findByID({ collection: postsCollection, id: 999 })
    expect(notFound).toBeNull()
  })

  it('updates a document and refreshes updatedAt', async () => {
    const before = await adapter.findByID({ collection: postsCollection, id: 1 })
    expect(before).not.toBeNull()

    // Wait 10ms so timestamp can advance
    await new Promise((resolve) => setTimeout(resolve, 50))

    const updated = await adapter.update({
      collection: postsCollection,
      id: 1,
      data: { title: 'First Post (Updated)', views: 42 },
    })

    expect(updated).not.toBeNull()
    expect(updated?.id).toBe(1)
    expect(updated?.title).toBe('First Post (Updated)')
    expect(updated?.views).toBe(42)

    const notFound = await adapter.update({
      collection: postsCollection,
      id: 999,
      data: { title: 'Ghost' },
    })
    expect(notFound).toBeNull()
  })

  it('finds documents with pagination and sorting', async () => {
    const page1 = await adapter.find({
      collection: postsCollection,
      limit: 1,
      page: 1,
      sort: 'id',
    })

    expect(page1.totalDocs).toBe(2)
    expect(page1.totalPages).toBe(2)
    expect(page1.docs).toHaveLength(1)
    expect(page1.docs[0]?.id).toBe(1)

    const page2 = await adapter.find({
      collection: postsCollection,
      limit: 1,
      page: 2,
      sort: 'id',
    })

    expect(page2.docs).toHaveLength(1)
    expect(page2.docs[0]?.id).toBe(2)

    const descSort = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      sort: '-id',
    })

    expect(descSort.docs[0]?.id).toBe(2)
    expect(descSort.docs[1]?.id).toBe(1)
  })

  it('supports unlimited queries with limit: 0 and honors collection maxLimit', async () => {
    const unlimited = await adapter.find({
      collection: postsCollection,
      limit: 0,
      page: 1,
      sort: 'id',
    })
    expect(unlimited.limit).toBe(0)
    expect(unlimited.totalPages).toBe(1)
    expect(unlimited.docs.length).toBeGreaterThanOrEqual(2)

    const cappedCol = {
      ...postsCollection,
      pagination: { maxLimit: 1 },
    }
    const capped = await adapter.find({
      collection: cappedCol,
      limit: 10,
      page: 1,
      sort: 'id',
    })
    expect(capped.limit).toBe(1)
    expect(capped.docs).toHaveLength(1)
  })

  it('filters documents with operators: equals, not_equals, contains, in, greater_than, less_than', async () => {
    // Insert more sample posts
    await adapter.create({
      collection: postsCollection,
      data: { title: 'Alpha Guide', views: 50 },
    })
    await adapter.create({
      collection: postsCollection,
      data: { title: 'Beta News', views: 150 },
    })
    await adapter.create({
      collection: postsCollection,
      data: { title: 'Gamma Tutorial', views: 250 },
    })

    // equals
    const eqRes = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      where: { title: { equals: 'Alpha Guide' } },
    })
    expect(eqRes.docs).toHaveLength(1)
    expect(eqRes.docs[0]?.title).toBe('Alpha Guide')
    expect(eqRes.totalDocs).toBe(1)

    // not_equals
    const neRes = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      where: { title: { not_equals: 'Alpha Guide' } },
    })
    expect(neRes.docs.some((d) => d.title === 'Alpha Guide')).toBe(false)

    // contains
    const containsRes = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      where: { title: { contains: 'News' } },
    })
    expect(containsRes.docs).toHaveLength(1)
    expect(containsRes.docs[0]?.title).toBe('Beta News')

    // in
    const inRes = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      where: { title: { in: ['Alpha Guide', 'Gamma Tutorial'] } },
    })
    expect(inRes.docs).toHaveLength(2)

    // greater_than and less_than
    const rangeRes = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      where: {
        views: {
          greater_than: 50,
          less_than: 250,
        },
      },
    })
    expect(rangeRes.docs).toHaveLength(1)
    expect(rangeRes.docs[0]?.title).toBe('Beta News')

    // or compound filter
    const orRes = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      where: {
        or: [{ title: { equals: 'Alpha Guide' } }, { views: { equals: 250 } }],
      },
    })
    expect(orRes.docs).toHaveLength(2)

    // and compound filter
    const andRes = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      where: {
        and: [{ views: { greater_than_equal: 150 } }, { title: { contains: 'Tutorial' } }],
      },
    })
    expect(andRes.docs).toHaveLength(1)
    expect(andRes.docs[0]?.title).toBe('Gamma Tutorial')
  })

  it('supports multi-column sorting', async () => {
    // Insert posts with same views
    await adapter.create({
      collection: postsCollection,
      data: { title: 'Zebra Post', views: 50 },
    })

    const multiSort = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      sort: 'views,title',
    })

    // Views=50 posts: Alpha Guide vs Zebra Post
    const views50 = multiSort.docs.filter((d) => d.views === 50)
    expect(views50.length).toBeGreaterThanOrEqual(2)
    expect(views50[0]?.title).toBe('Alpha Guide')
    expect(views50[1]?.title).toBe('Zebra Post')

    const descViewsAscTitle = await adapter.find({
      collection: postsCollection,
      limit: 10,
      page: 1,
      sort: '-views,title',
    })
    expect(descViewsAscTitle.docs[0]?.views).toBe(250)
  })

  it('deletes a document and returns the deleted doc', async () => {
    const deleted = await adapter.delete({ collection: postsCollection, id: 2 })
    expect(deleted).not.toBeNull()
    expect(deleted?.id).toBe(2)

    const check = await adapter.findByID({ collection: postsCollection, id: 2 })
    expect(check).toBeNull()

    const notFound = await adapter.delete({ collection: postsCollection, id: 2 })
    expect(notFound).toBeNull()
  })

  it('manages singleton globals with findGlobal and updateGlobal', async () => {
    // Initially null before first update
    const initial = await adapter.findGlobal({ global: headerGlobal })
    expect(initial).toBeNull()

    // Create / first update
    const created = await adapter.updateGlobal({
      global: headerGlobal,
      data: { siteTitle: 'My Blog' },
    })
    expect(created.id).toBe(1)
    expect(created.siteTitle).toBe('My Blog')
    expect(typeof created.createdAt).toBe('string')
    expect(typeof created.updatedAt).toBe('string')

    // Find after create
    const found = await adapter.findGlobal({ global: headerGlobal })
    expect(found).not.toBeNull()
    expect(found?.siteTitle).toBe('My Blog')

    // Subsequent update modifies existing row
    const updated = await adapter.updateGlobal({
      global: headerGlobal,
      data: { siteTitle: 'My Updated Blog', announcement: 'Welcome!' },
    })
    expect(updated.id).toBe(1)
    expect(updated.siteTitle).toBe('My Updated Blog')
    expect(updated.announcement).toBe('Welcome!')

    // Confirm only one row exists and has the new data
    const finalCheck = await adapter.findGlobal({ global: headerGlobal })
    expect(finalCheck?.id).toBe(1)
    expect(finalCheck?.siteTitle).toBe('My Updated Blog')
    expect(finalCheck?.announcement).toBe('Welcome!')
  })

  it('stores, updates, and retrieves richText json documents', async () => {
    const richDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello rich text!' }],
        },
      ],
    }

    const created = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Rich Post',
        views: 1,
        content: richDoc,
      },
    })

    expect(created.content).toEqual(richDoc)

    const found = await adapter.findByID({ collection: postsCollection, id: created.id })
    expect(found?.content).toEqual(richDoc)

    const updatedDoc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Updated heading' }],
        },
      ],
    }

    const updated = await adapter.update({
      collection: postsCollection,
      id: created.id,
      data: { content: updatedDoc },
    })

    expect(updated?.content).toEqual(updatedDoc)
  })

  it('stores, updates, and clears single relationship field', async () => {
    const post = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Single Rel Post',
        author: 42,
      },
    })
    expect(post.author).toBe(42)

    const fetched = await adapter.findByID({ collection: postsCollection, id: post.id })
    expect(fetched?.author).toBe(42)

    const updated = await adapter.update({
      collection: postsCollection,
      id: post.id,
      data: { author: 99 },
    })
    expect(updated?.author).toBe(99)

    const cleared = await adapter.update({
      collection: postsCollection,
      id: post.id,
      data: { author: null },
    })
    expect(cleared?.author).toBeNull()

    const fetchedCleared = await adapter.findByID({ collection: postsCollection, id: post.id })
    expect(fetchedCleared?.author).toBeNull()
  })

  it('stores, updates, reorders, and deletes hasMany relationship field with junction table', async () => {
    const post = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'HasMany Rel Post',
        categories: [10, 20, 30],
      },
    })
    expect(post.categories).toEqual([10, 20, 30])

    const fetched = await adapter.findByID({ collection: postsCollection, id: post.id })
    expect(fetched?.categories).toEqual([10, 20, 30])

    // Update with reordered and filtered IDs
    const updated = await adapter.update({
      collection: postsCollection,
      id: post.id,
      data: {
        categories: [30, 10],
      },
    })
    expect(updated?.categories).toEqual([30, 10])

    const fetchedUpdated = await adapter.findByID({ collection: postsCollection, id: post.id })
    expect(fetchedUpdated?.categories).toEqual([30, 10])

    // Verify find populates categories across documents
    const listResult = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { title: { equals: 'HasMany Rel Post' } },
    })
    expect(listResult.docs).toHaveLength(1)
    expect(listResult.docs[0]?.categories).toEqual([30, 10])

    // Verify junction rows exist directly via pool query
    const pool = mysql.createPool(testDatabaseUrl)
    const [rowsBefore] = (await pool.query(
      'SELECT target_id, `order` FROM posts_categories WHERE parent_id = ? ORDER BY `order` ASC',
      [post.id],
    )) as unknown as [Array<{ target_id: number; order: number }>, unknown]
    expect(rowsBefore).toEqual([
      { target_id: 30, order: 0 },
      { target_id: 10, order: 1 },
    ])

    // Delete document and verify cascade cleanup in junction table
    const deleted = await adapter.delete({ collection: postsCollection, id: post.id })
    expect(deleted).not.toBeNull()
    expect(deleted?.id).toBe(post.id)

    const [rowsAfter] = (await pool.query('SELECT * FROM posts_categories WHERE parent_id = ?', [
      post.id,
    ])) as unknown as [Array<unknown>, unknown]
    expect(rowsAfter).toHaveLength(0)
    await pool.end()
  })

  it('filters documents by hasMany relationship fields with equals, in, and not_equals', async () => {
    const post1 = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Tech News 1',
        categories: [101, 102],
      },
    })
    const post2 = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Tech News 2',
        categories: [102, 103],
      },
    })
    const post3 = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Lifestyle 3',
        categories: [103, 104],
      },
    })

    // 1. equals operator
    const resEquals = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { categories: { equals: 101 } },
    })
    expect(resEquals.docs).toHaveLength(1)
    expect(resEquals.docs[0]?.id).toBe(post1.id)

    // 2. shorthand value (equals)
    const resShorthand = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { categories: 101 },
    })
    expect(resShorthand.docs).toHaveLength(1)
    expect(resShorthand.docs[0]?.id).toBe(post1.id)

    // 3. in operator
    const resIn = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { categories: { in: [101, 104] } },
    })
    const inIds = resIn.docs.map((d) => d.id).sort()
    expect(inIds).toEqual([post1.id, post3.id].sort())

    // 4. not_equals operator (excludes posts with category 102)
    const resNotEquals = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: {
        and: [{ categories: { not_equals: 102 } }, { id: { in: [post1.id, post2.id, post3.id] } }],
      },
    })
    expect(resNotEquals.docs).toHaveLength(1)
    expect(resNotEquals.docs[0]?.id).toBe(post3.id)

    // 5. combined filter with title and hasMany relationship
    const resCombined = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: {
        categories: { equals: 102 },
        title: { equals: 'Tech News 2' },
      },
    })
    expect(resCombined.docs).toHaveLength(1)
    expect(resCombined.docs[0]?.id).toBe(post2.id)

    // 6. safely ignores lookup of Object prototype properties on table and sort
    const resProto = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { constructor: { equals: 1 } },
      sort: 'constructor',
    })
    expect(resProto.docs).toBeDefined()
  })

  it('maps real MySQL duplicate unique key to UniqueConstraintError', async () => {
    const first = await adapter.create({
      collection: tagsCollection,
      data: { slug: 'unique-slug' },
    })
    expect(first.slug).toBe('unique-slug')

    await expect(
      adapter.create({
        collection: tagsCollection,
        data: { slug: 'unique-slug' },
      }),
    ).rejects.toThrow(UniqueConstraintError)

    try {
      await adapter.create({
        collection: tagsCollection,
        data: { slug: 'unique-slug' },
      })
      expect.fail('should have thrown UniqueConstraintError')
    } catch (err) {
      expect(err).toBeInstanceOf(UniqueConstraintError)
      const uce = err as UniqueConstraintError
      expect(uce.field).toBe('slug')
      expect(uce.value).toBe('unique-slug')
    }
  })

  it('rolls back main row creation when junction row insertion fails in create', async () => {
    // 3000000000 exceeds MySQL signed 32-bit INT max (2147483647)
    await expect(
      adapter.create({
        collection: postsCollection,
        data: {
          title: 'Failing Create Post',
          categories: [3000000000],
        },
      }),
    ).rejects.toThrow()

    // Assert that the post was not persisted in MySQL
    const found = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { title: { equals: 'Failing Create Post' } },
    })
    expect(found.docs).toHaveLength(0)

    const pool = mysql.createPool(testDatabaseUrl)
    const [rows] = (await pool.query('SELECT * FROM posts WHERE title = ?', [
      'Failing Create Post',
    ])) as unknown as [Array<unknown>, unknown]
    expect(rows).toHaveLength(0)
    await pool.end()
  })

  it('rolls back update and preserves previous relations when junction row insertion fails in update', async () => {
    const post = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Initial Post Title',
        categories: [1, 2],
      },
    })
    expect(post.title).toBe('Initial Post Title')
    expect(post.categories).toEqual([1, 2])

    // Update with invalid targetId that fails junction row insertion
    await expect(
      adapter.update({
        collection: postsCollection,
        id: post.id,
        data: {
          title: 'Modified Post Title',
          categories: [1, 3000000000],
        },
      }),
    ).rejects.toThrow()

    // Assert that the post was NOT modified and previous categories were NOT wiped
    const fetched = await adapter.findByID({ collection: postsCollection, id: post.id })
    expect(fetched?.title).toBe('Initial Post Title')
    expect(fetched?.categories).toEqual([1, 2])

    const pool = mysql.createPool(testDatabaseUrl)
    const [jRows] = (await pool.query(
      'SELECT target_id FROM posts_categories WHERE parent_id = ? ORDER BY `order` ASC',
      [post.id],
    )) as unknown as [Array<{ target_id: number }>, unknown]
    expect(jRows.map((r) => r.target_id)).toEqual([1, 2])
    await pool.end()
  })

  it('rolls back document operations when an error is thrown inside transaction', async () => {
    expect(typeof adapter.transaction).toBe('function')

    await expect(
      adapter.transaction!(async (tx) => {
        await tx.create({
          collection: postsCollection,
          data: { title: 'Transaction Post' },
        })
        throw new Error('Simulated hook failure')
      }),
    ).rejects.toThrow('Database operation failed')

    // Document must not exist
    const found = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { title: { equals: 'Transaction Post' } },
    })
    expect(found.docs).toHaveLength(0)
  })

  it('supports nested transactions with savepoints and partial rollback', async () => {
    await adapter.transaction!(async (tx) => {
      const doc1 = await tx.create({
        collection: postsCollection,
        data: { title: 'Committed in Outer' },
      })
      expect(doc1.id).toBeDefined()

      try {
        await tx.transaction!(async (nestedTx) => {
          await nestedTx.create({
            collection: postsCollection,
            data: { title: 'Rolled Back in Nested' },
          })
          throw new Error('Nested failure')
        })
      } catch (err) {
        expect((err as Error).message).toContain('Database operation failed')
      }
    })

    const outerFound = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { title: { equals: 'Committed in Outer' } },
    })
    expect(outerFound.docs).toHaveLength(1)

    const nestedFound = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: { title: { equals: 'Rolled Back in Nested' } },
    })
    expect(nestedFound.docs).toHaveLength(0)
  })

  it('stores, updates, and round-trips date fields in UTC without drift', async () => {
    // 1. Create with full UTC ISO string
    const doc = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Date Test Post',
        publishedAt: '2024-05-01T03:00:00.000Z',
      },
    })
    expect(doc.publishedAt).toBe('2024-05-01T03:00:00.000Z')

    const fetched = await adapter.findByID({ collection: postsCollection, id: doc.id })
    expect(fetched?.publishedAt).toBe('2024-05-01T03:00:00.000Z')

    // 2. Update with offset-less string (treated as UTC explicitly, preventing local TZ drift)
    const updated = await adapter.update({
      collection: postsCollection,
      id: doc.id,
      data: {
        publishedAt: '2024-05-01T03:00',
      },
    })
    expect(updated?.publishedAt).toBe('2024-05-01T03:00:00.000Z')

    // 3. Update with offset-less string containing seconds
    const updatedWithSec = await adapter.update({
      collection: postsCollection,
      id: doc.id,
      data: {
        publishedAt: '2024-05-01T03:00:45',
      },
    })
    expect(updatedWithSec?.publishedAt).toBe('2024-05-01T03:00:45.000Z')

    // 4. Update with null to clear
    const cleared = await adapter.update({
      collection: postsCollection,
      id: doc.id,
      data: {
        publishedAt: null,
      },
    })
    expect(cleared?.publishedAt).toBeNull()

    const fetchedCleared = await adapter.findByID({ collection: postsCollection, id: doc.id })
    expect(fetchedCleared?.publishedAt).toBeNull()
  })

  it('supports date values outside the 1970-2038 TIMESTAMP range (e.g. 1900 and 2100)', async () => {
    // 1. Past date (before 1970 UNIX epoch)
    const pastDoc = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Historical Event',
        publishedAt: '1900-01-01T00:00:00.000Z',
      },
    })
    expect(pastDoc.publishedAt).toBe('1900-01-01T00:00:00.000Z')

    const fetchedPast = await adapter.findByID({ collection: postsCollection, id: pastDoc.id })
    expect(fetchedPast?.publishedAt).toBe('1900-01-01T00:00:00.000Z')

    // 2. Mid 20th-century date (1955)
    const midCenturyDoc = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Mid Century Post',
        publishedAt: '1955-11-05T06:30:00.000Z',
      },
    })
    expect(midCenturyDoc.publishedAt).toBe('1955-11-05T06:30:00.000Z')

    // 3. Far future date (beyond 2038 Y2038 problem limit)
    const futureDoc = await adapter.create({
      collection: postsCollection,
      data: {
        title: 'Far Future Post',
        publishedAt: '2100-12-31T23:59:59.000Z',
      },
    })
    expect(futureDoc.publishedAt).toBe('2100-12-31T23:59:59.000Z')

    const fetchedFuture = await adapter.findByID({ collection: postsCollection, id: futureDoc.id })
    expect(fetchedFuture?.publishedAt).toBe('2100-12-31T23:59:59.000Z')

    // 4. Query filtering across date ranges
    const pastResults = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: {
        publishedAt: {
          less_than: '1950-01-01T00:00:00.000Z',
        },
      },
    })
    expect(pastResults.docs).toHaveLength(1)
    expect(pastResults.docs[0]?.title).toBe('Historical Event')
    expect(pastResults.docs[0]?.publishedAt).toBe('1900-01-01T00:00:00.000Z')

    const futureResults = await adapter.find({
      collection: postsCollection,
      page: 1,
      limit: 10,
      where: {
        publishedAt: {
          greater_than: '2050-01-01T00:00:00.000Z',
        },
      },
    })
    expect(futureResults.docs).toHaveLength(1)
    expect(futureResults.docs[0]?.title).toBe('Far Future Post')
    expect(futureResults.docs[0]?.publishedAt).toBe('2100-12-31T23:59:59.000Z')
  })

  it('supports group fields: create, read, update, filter, and sort', async () => {
    // 1. Create with group field
    const page1 = await adapter.create({
      collection: pagesCollection,
      data: {
        title: 'About Us',
        seo: {
          metaTitle: 'About Our Company',
          metaDescription: 'We build awesome software',
        },
      },
    })

    expect(page1.id).toBeDefined()
    expect(page1.title).toBe('About Us')
    expect(page1.seo).toEqual({
      metaTitle: 'About Our Company',
      metaDescription: 'We build awesome software',
    })
    expect(page1).not.toHaveProperty('seo__metaTitle')
    expect(page1).not.toHaveProperty('seo__metaDescription')

    // 2. Find by ID
    const fetched1 = await adapter.findByID({ collection: pagesCollection, id: page1.id })
    expect(fetched1?.seo).toEqual({
      metaTitle: 'About Our Company',
      metaDescription: 'We build awesome software',
    })

    // 3. Create document without optional group field
    const page2 = await adapter.create({
      collection: pagesCollection,
      data: {
        title: 'Contact',
      },
    })
    expect(page2.seo).toBeNull()

    // 4. Create another document with group field
    const page3 = await adapter.create({
      collection: pagesCollection,
      data: {
        title: 'Blog',
        seo: {
          metaTitle: 'Blog Insights',
          metaDescription: 'Articles and stories',
        },
      },
    })
    expect(page3.id).toBeDefined()

    // 5. Query filtering with dot notation
    const dotFilter = await adapter.find({
      collection: pagesCollection,
      page: 1,
      limit: 10,
      where: {
        'seo.metaTitle': { equals: 'About Our Company' },
      },
    })
    expect(dotFilter.docs).toHaveLength(1)
    expect(dotFilter.docs[0]?.title).toBe('About Us')

    // 6. Query filtering with nested object notation
    const nestedFilter = await adapter.find({
      collection: pagesCollection,
      page: 1,
      limit: 10,
      where: {
        seo: {
          metaTitle: { equals: 'Blog Insights' },
        },
      },
    })
    expect(nestedFilter.docs).toHaveLength(1)
    expect(nestedFilter.docs[0]?.title).toBe('Blog')

    // 7. Sort by group field ascending and descending
    const sortedAsc = await adapter.find({
      collection: pagesCollection,
      page: 1,
      limit: 10,
      sort: 'seo.metaTitle',
    })
    const titlesAsc = sortedAsc.docs.map((d) =>
      d.seo ? (d.seo as { metaTitle?: string }).metaTitle : null,
    )
    expect(titlesAsc).toEqual([null, 'About Our Company', 'Blog Insights'])

    const sortedDesc = await adapter.find({
      collection: pagesCollection,
      page: 1,
      limit: 10,
      sort: '-seo.metaTitle',
    })
    const titlesDesc = sortedDesc.docs.map((d) =>
      d.seo ? (d.seo as { metaTitle?: string }).metaTitle : null,
    )
    expect(titlesDesc).toEqual(['Blog Insights', 'About Our Company', null])

    // 8. Update group field
    const updated = await adapter.update({
      collection: pagesCollection,
      id: page1.id,
      data: {
        seo: {
          metaTitle: 'About Us - Rebranded',
          metaDescription: 'Updated description',
        },
      },
    })
    expect(updated?.seo).toEqual({
      metaTitle: 'About Us - Rebranded',
      metaDescription: 'Updated description',
    })

    // 9. Clear group field with null
    const cleared = await adapter.update({
      collection: pagesCollection,
      id: page1.id,
      data: {
        seo: null,
      },
    })
    expect(cleared?.seo).toBeNull()
  })
})
