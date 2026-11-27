import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createLontar,
  createLontarClient,
  UniqueConstraintError,
  type Config,
  type DatabaseAdapter,
  type Where,
} from '@lontar/core'
import { findDrizzleKitBin } from './drizzle-kit'
import {
  categoriesCollection,
  conditionalPostsCollection,
  createTestConfig,
  headerGlobal,
  joinAuthorsCollection,
  joinBooksCollection,
  localizedHeaderGlobal,
  localizedPostsCollection,
  longSlugVersionedCollection,
  nestedCollection,
  pagesCollection,
  polymorphicActivitiesCollection,
  postsCollection,
  sharedBlocksCollection,
  snippetsCollection,
  tagsCollection,
  versionedPostsCollection,
  versionedSettingsGlobal,
  versionHistoryCollection,
} from './fixtures'
import type { ConformanceSuiteContext, ConformanceSuiteOptions, TestDatabaseHandle } from './types'

async function collectPagedIds(
  adapter: DatabaseAdapter,
  options: { sort?: string; pageSize: number; totalPages: number },
): Promise<number[]> {
  const ids: number[] = []
  for (let p = 1; p <= options.totalPages; p++) {
    const res = await adapter.find({
      collection: categoriesCollection,
      limit: options.pageSize,
      page: p,
      ...(options.sort ? { sort: options.sort } : {}),
    })
    expect(res.docs).toHaveLength(options.pageSize)
    ids.push(...res.docs.map((doc) => doc.id))
  }
  return ids
}

export function registerAdapterConformanceSuite(
  context: ConformanceSuiteContext,
  options?: ConformanceSuiteOptions,
): void {
  const suiteName = `${context.name} (integration)`
  const adapterLabel =
    context.label ?? (context.dialect === 'mysql' ? 'MySQL adapter' : `${context.name} adapter`)
  const dbName =
    context.dialect === 'mysql'
      ? 'MySQL'
      : context.dialect === 'postgresql'
        ? 'Postgres'
        : context.dialect

  describe(suiteName, () => {
    let testDb: TestDatabaseHandle
    let testDatabaseUrl: string
    let adapter: DatabaseAdapter
    let config: Config
    let tempDir: string
    let migrationsDir: string

    beforeAll(async () => {
      testDb = await context.setupTestDatabase()
      testDatabaseUrl = testDb.url
      adapter = context.createAdapter(testDatabaseUrl)
      config = createTestConfig(adapter)

      // Prepare temp dir and schema file
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lontar-${context.dialect}-test-`))
      const schemaFile = path.join(tempDir, 'schema.ts')
      migrationsDir = path.join(tempDir, 'migrations')
      fs.writeFileSync(schemaFile, adapter.toSchemaFile(config), 'utf-8')

      // Run drizzle-kit generate
      const drizzleKitBin = findDrizzleKitBin()
      execFileSync(process.execPath, [
        drizzleKitBin,
        'generate',
        '--dialect',
        context.dialect,
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
          const closable = adapter as { close?: () => Promise<void> }
          if (typeof closable.close === 'function') {
            await closable.close()
          }
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

    function testCase(title: string, fn: () => Promise<void> | void) {
      const shouldSkip = options?.skipTests?.some((skip) => title === skip || title.includes(skip))
      if (shouldSkip) {
        it.skip(title, fn)
      } else {
        it(title, fn)
      }
    }

    testCase('creates documents and returns StoredDoc with system fields', async () => {
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

    testCase('finds document by ID', async () => {
      const found = await adapter.findByID({ collection: postsCollection, id: 1 })
      expect(found).not.toBeNull()
      expect(found?.title).toBe('First Post')

      const notFound = await adapter.findByID({ collection: postsCollection, id: 999 })
      expect(notFound).toBeNull()
    })

    testCase('updates a document and refreshes updatedAt', async () => {
      const before = await adapter.findByID({ collection: postsCollection, id: 1 })
      expect(before).not.toBeNull()

      // Wait for timestamp to advance (MySQL audit timestamp has 1s precision, Postgres has 1ms)
      const beforeTime = new Date(before!.updatedAt).getTime()
      if (context.dialect === 'mysql') {
        while (Date.now() <= beforeTime + 1000) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      const updated = await adapter.update({
        collection: postsCollection,
        id: 1,
        data: { title: 'First Post (Updated)', views: 42 },
      })

      expect(updated).not.toBeNull()
      expect(updated?.id).toBe(1)
      expect(updated?.title).toBe('First Post (Updated)')
      expect(updated?.views).toBe(42)
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(
        new Date(before!.updatedAt).getTime(),
      )

      const notFound = await adapter.update({
        collection: postsCollection,
        id: 999,
        data: { title: 'Ghost' },
      })
      expect(notFound).toBeNull()
    })

    testCase('finds documents with pagination and sorting', async () => {
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

    testCase(
      'appends unique id tiebreaker to ORDER BY for stable pagination across ties',
      async () => {
        const total = 15
        for (let i = 0; i < total; i++) {
          await adapter.create({
            collection: categoriesCollection,
            data: { name: 'Identical' },
          })
        }

        const paging = { pageSize: 5, totalPages: 3 }

        // 1. Ascending sort on non-unique field: id must break ties ascending
        const ascIds = await collectPagedIds(adapter, { ...paging, sort: 'name' })
        expect(ascIds).toHaveLength(total)
        expect(new Set(ascIds).size).toBe(total)
        expect(ascIds).toEqual([...ascIds].sort((a, b) => a - b))

        // 2. Descending sort on non-unique field: id must break ties descending
        const descIds = await collectPagedIds(adapter, { ...paging, sort: '-name' })
        expect(descIds).toHaveLength(total)
        expect(new Set(descIds).size).toBe(total)
        expect(descIds).toEqual([...descIds].sort((a, b) => b - a))

        // 3. Default sort (no explicit sort): id must break ties descending
        const defaultIds = await collectPagedIds(adapter, paging)
        expect(defaultIds).toHaveLength(total)
        expect(new Set(defaultIds).size).toBe(total)
        expect(defaultIds).toEqual([...defaultIds].sort((a, b) => b - a))
      },
    )

    testCase(
      'supports unlimited queries with limit: 0 and honors collection maxLimit',
      async () => {
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

        const overridden = await adapter.find({
          collection: cappedCol,
          limit: 10,
          page: 1,
          sort: 'id',
          overrideLimit: true,
        })
        expect(overridden.limit).toBe(10)
        expect(overridden.docs.length).toBeGreaterThanOrEqual(2)
      },
    )

    testCase(
      'filters documents with operators: equals, not_equals, contains, in, greater_than, less_than',
      async () => {
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
      },
    )

    testCase(
      'escapes LIKE wildcards in contains operator for top-level and nested fields (#324)',
      async () => {
        // 1. Top-level text field with %, _ and \
        await adapter.create({
          collection: postsCollection,
          data: { title: 'Special 50% discount' },
        })
        await adapter.create({
          collection: postsCollection,
          data: { title: 'Special 500 items' },
        })
        await adapter.create({
          collection: postsCollection,
          data: { title: 'Prefix a_b suffix' },
        })
        await adapter.create({
          collection: postsCollection,
          data: { title: 'Prefix axb suffix' },
        })
        await adapter.create({
          collection: postsCollection,
          data: { title: 'Path C:\\test\\file' },
        })

        // Literal '%' must not match '500'
        const pctRes = await adapter.find({
          collection: postsCollection,
          limit: 10,
          page: 1,
          where: { title: { contains: '50%' } },
        })
        expect(pctRes.docs.map((d) => d.title)).toEqual(['Special 50% discount'])

        // Literal '_' must not match 'axb'
        const underscoreRes = await adapter.find({
          collection: postsCollection,
          limit: 10,
          page: 1,
          where: { title: { contains: 'a_b' } },
        })
        expect(underscoreRes.docs.map((d) => d.title)).toEqual(['Prefix a_b suffix'])

        // Literal '\' must match literal backslash
        const backslashRes = await adapter.find({
          collection: postsCollection,
          limit: 10,
          page: 1,
          where: { title: { contains: 'C:\\test' } },
        })
        expect(backslashRes.docs.map((d) => d.title)).toEqual(['Path C:\\test\\file'])

        // 'like' operator preserves wildcards
        const likePctRes = await adapter.find({
          collection: postsCollection,
          limit: 10,
          page: 1,
          where: { title: { like: '%50%' } },
        })
        const likeTitles = likePctRes.docs.map((d) => d.title)
        expect(likeTitles).toContain('Special 50% discount')
        expect(likeTitles).toContain('Special 500 items')

        // 2. Nested array field
        const docArrayPct = await adapter.create({
          collection: nestedCollection,
          data: {
            title: 'Nested Array Percent',
            gallery: [{ caption: 'Save 20% today' }],
          },
        })
        const docArrayNonPct = await adapter.create({
          collection: nestedCollection,
          data: {
            title: 'Nested Array Non-Percent',
            gallery: [{ caption: 'Save 200 today' }],
          },
        })

        const nestedArrayRes = await adapter.find({
          collection: nestedCollection,
          limit: 10,
          page: 1,
          where: { 'gallery.caption': { contains: '20%' } },
        })
        const arrayDocIds = nestedArrayRes.docs.map((d) => d.id)
        expect(arrayDocIds).toContain(docArrayPct.id)
        expect(arrayDocIds).not.toContain(docArrayNonPct.id)

        // 3. Blocks field
        const docBlockUnderscore = await adapter.create({
          collection: nestedCollection,
          data: {
            title: 'Block Underscore',
            layout: [{ blockType: 'hero', heading: 'Super item_1 deal' }],
          },
        })
        const docBlockLetter = await adapter.create({
          collection: nestedCollection,
          data: {
            title: 'Block Letter',
            layout: [{ blockType: 'hero', heading: 'Super itemX1 deal' }],
          },
        })

        const blockRes = await adapter.find({
          collection: nestedCollection,
          limit: 10,
          page: 1,
          where: { 'layout.heading': { contains: 'item_1' } },
        })
        const blockDocIds = blockRes.docs.map((d) => d.id)
        expect(blockDocIds).toContain(docBlockUnderscore.id)
        expect(blockDocIds).not.toContain(docBlockLetter.id)
      },
    )

    testCase('supports multi-column sorting', async () => {
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

    testCase('deletes a document and returns the deleted doc', async () => {
      const deleted = await adapter.delete({ collection: postsCollection, id: 2 })
      expect(deleted).not.toBeNull()
      expect(deleted?.id).toBe(2)

      const check = await adapter.findByID({ collection: postsCollection, id: 2 })
      expect(check).toBeNull()

      const notFound = await adapter.delete({ collection: postsCollection, id: 2 })
      expect(notFound).toBeNull()
    })

    testCase('manages singleton globals with findGlobal and updateGlobal', async () => {
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

      // Wait for timestamp to advance (MySQL audit timestamp has 1s precision, Postgres has 1ms)
      const createdTime = new Date(created.updatedAt).getTime()
      if (context.dialect === 'mysql') {
        while (Date.now() <= createdTime + 1000) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      // Subsequent update modifies existing row
      const updated = await adapter.updateGlobal({
        global: headerGlobal,
        data: { siteTitle: 'My Updated Blog', announcement: 'Welcome!' },
      })
      expect(updated.id).toBe(1)
      expect(updated.siteTitle).toBe('My Updated Blog')
      expect(updated.announcement).toBe('Welcome!')
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(createdTime)

      // Confirm only one row exists and has the new data
      const finalCheck = await adapter.findGlobal({ global: headerGlobal })
      expect(finalCheck?.id).toBe(1)
      expect(finalCheck?.siteTitle).toBe('My Updated Blog')
      expect(finalCheck?.announcement).toBe('Welcome!')
    })

    testCase('stores, updates, and retrieves richText json documents', async () => {
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

    testCase('stores, updates, and clears single relationship field', async () => {
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

    testCase(
      'stores, updates, reorders, and deletes hasMany relationship field with junction table',
      async () => {
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

        // Verify junction rows exist directly via raw query if provided
        if (context.queryRaw) {
          const rowsBefore = await context.queryRaw(
            testDatabaseUrl,
            {
              mysql:
                'SELECT target_id, `order` FROM posts_categories WHERE parent_id = ? ORDER BY `order` ASC',
              postgresql:
                'SELECT target_id, "order" FROM posts_categories WHERE parent_id = $1 ORDER BY "order" ASC',
            },
            [post.id],
          )
          expect(rowsBefore).toEqual([
            { target_id: 30, order: 0 },
            { target_id: 10, order: 1 },
          ])
        }

        // Delete document and verify cascade cleanup in junction table
        const deleted = await adapter.delete({ collection: postsCollection, id: post.id })
        expect(deleted).not.toBeNull()
        expect(deleted?.id).toBe(post.id)

        if (context.queryRaw) {
          const rowsAfter = await context.queryRaw(
            testDatabaseUrl,
            {
              mysql: 'SELECT * FROM posts_categories WHERE parent_id = ?',
              postgresql: 'SELECT * FROM posts_categories WHERE parent_id = $1',
            },
            [post.id],
          )
          expect(rowsAfter).toHaveLength(0)
        }
      },
    )

    testCase(
      'filters documents by hasMany relationship fields with equals, in, and not_equals',
      async () => {
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
            and: [
              { categories: { not_equals: 102 } },
              { id: { in: [post1.id, post2.id, post3.id] } },
            ],
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
      },
    )

    testCase(`maps real ${dbName} duplicate unique key to UniqueConstraintError`, async () => {
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

    testCase(
      'rolls back main row creation when junction row insertion fails in create',
      async () => {
        // 3000000000 exceeds signed 32-bit INT max (2147483647)
        await expect(
          adapter.create({
            collection: postsCollection,
            data: {
              title: 'Failing Create Post',
              categories: [3000000000],
            },
          }),
        ).rejects.toThrow()

        // Assert that the post was not persisted in database
        const found = await adapter.find({
          collection: postsCollection,
          page: 1,
          limit: 10,
          where: { title: { equals: 'Failing Create Post' } },
        })
        expect(found.docs).toHaveLength(0)

        if (context.queryRaw) {
          const rows = await context.queryRaw(
            testDatabaseUrl,
            {
              mysql: 'SELECT * FROM posts WHERE title = ?',
              postgresql: 'SELECT * FROM posts WHERE title = $1',
            },
            ['Failing Create Post'],
          )
          expect(rows).toHaveLength(0)
        }
      },
    )

    testCase(
      'rolls back update and preserves previous relations when junction row insertion fails in update',
      async () => {
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

        if (context.queryRaw) {
          const jRows = await context.queryRaw(
            testDatabaseUrl,
            {
              mysql:
                'SELECT target_id FROM posts_categories WHERE parent_id = ? ORDER BY `order` ASC',
              postgresql:
                'SELECT target_id FROM posts_categories WHERE parent_id = $1 ORDER BY "order" ASC',
            },
            [post.id],
          )
          expect(jRows.map((r: Record<string, unknown>) => r.target_id)).toEqual([1, 2])
        }
      },
    )

    testCase(
      'rolls back document operations when an error is thrown inside transaction',
      async () => {
        expect(typeof adapter.transaction).toBe('function')

        await expect(
          adapter.transaction!(async (tx) => {
            await tx.create({
              collection: postsCollection,
              data: { title: 'Transaction Post' },
            })
            throw new Error('Simulated hook failure')
          }),
        ).rejects.toThrow('Simulated hook failure')

        // Document must not exist
        const found = await adapter.find({
          collection: postsCollection,
          page: 1,
          limit: 10,
          where: { title: { equals: 'Transaction Post' } },
        })
        expect(found.docs).toHaveLength(0)
      },
    )

    testCase('supports nested transactions with savepoints and partial rollback', async () => {
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
          expect((err as Error).message).toContain('Nested failure')
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

    testCase('stores, updates, and round-trips date fields in UTC without drift', async () => {
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

    testCase(
      'supports date values outside the 1970-2038 TIMESTAMP range (e.g. 1900 and 2100)',
      async () => {
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

        const fetchedFuture = await adapter.findByID({
          collection: postsCollection,
          id: futureDoc.id,
        })
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
      },
    )

    testCase('supports group fields: create, read, update, filter, and sort', async () => {
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

    testCase('handles array fields: insert, reorder, and remove', async () => {
      // 1. Create with array rows without IDs
      const created = await adapter.create({
        collection: pagesCollection,
        data: {
          title: 'Gallery Page',
          gallery: [
            { caption: 'First photo', year: 2021 },
            { caption: 'Second photo', year: 2022 },
          ],
        },
      })
      expect(created.id).toBeDefined()
      const rows = created.gallery as Array<{ id: string; caption: string; year: number }>
      expect(rows).toHaveLength(2)
      const [first, second] = rows
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      expect(first!.id).toMatch(/^[0-9a-f]{16}$/)
      expect(second!.id).toMatch(/^[0-9a-f]{16}$/)
      expect(first!.caption).toBe('First photo')
      expect(second!.caption).toBe('Second photo')

      const row1Id = first!.id
      const row2Id = second!.id

      // 2. Reorder and add a third row
      const reordered = await adapter.update({
        collection: pagesCollection,
        id: created.id,
        data: {
          gallery: [
            { id: row2Id, caption: 'Second photo (now first)', year: 2022 },
            { id: row1Id, caption: 'First photo (now second)', year: 2021 },
            { caption: 'Third photo', year: 2023 },
          ],
        },
      })
      const reorderedRows = reordered?.gallery as Array<{
        id: string
        caption: string
        year: number
      }>
      expect(reorderedRows).toHaveLength(3)
      const [reordered1, reordered2, reordered3] = reorderedRows
      expect(reordered1!.id).toBe(row2Id)
      expect(reordered1!.caption).toBe('Second photo (now first)')
      expect(reordered2!.id).toBe(row1Id)
      expect(reordered3!.id).toMatch(/^[0-9a-f]{16}$/)
      expect(reordered3!.caption).toBe('Third photo')

      // 3. Remove a row
      const removed = await adapter.update({
        collection: pagesCollection,
        id: created.id,
        data: {
          gallery: [{ id: row1Id, caption: 'First photo only', year: 2021 }],
        },
      })
      const remainingRows = removed?.gallery as Array<{ id: string; caption: string; year: number }>
      expect(remainingRows).toHaveLength(1)
      expect(remainingRows[0]?.id).toBe(row1Id)
    })

    testCase('rolls back array field changes when transaction fails', async () => {
      const created = await adapter.create({
        collection: pagesCollection,
        data: {
          title: 'Rollback Gallery Page',
          gallery: [{ id: 'keep-this-row-1', caption: 'Initial photo', year: 2020 }],
        },
      })
      const originalRows = created.gallery as Array<{ id: string; caption: string; year: number }>

      await expect(
        adapter.transaction!(async (tx) => {
          await tx.update({
            collection: pagesCollection,
            id: created.id,
            data: {
              gallery: [],
            },
          })
          throw new Error('Forced rollback')
        }),
      ).rejects.toThrow('Forced rollback')

      const afterRollback = await adapter.findByID({
        collection: pagesCollection,
        id: created.id,
      })
      expect(afterRollback?.gallery).toEqual(originalRows)
    })

    testCase('handles blocks fields: insert, reorder, modify, and rollback', async () => {
      // 1. Create with blocks without IDs
      const created = await adapter.create({
        collection: pagesCollection,
        data: {
          title: 'Landing Page',
          layout: [
            { blockType: 'hero', heading: 'Welcome to our platform' },
            { blockType: 'cta', text: 'Get Started', buttonUrl: 'https://example.com' },
          ],
        },
      })
      expect(created.id).toBeDefined()
      const blocks = created.layout as Array<{
        id: string
        blockType: string
        heading?: string
        text?: string
        buttonUrl?: string
      }>
      expect(blocks).toHaveLength(2)
      const [first, second] = blocks
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      expect(first!.id).toMatch(/^[0-9a-f]{16}$/)
      expect(second!.id).toMatch(/^[0-9a-f]{16}$/)
      expect(first!.blockType).toBe('hero')
      expect(first!.heading).toBe('Welcome to our platform')
      expect(second!.blockType).toBe('cta')
      expect(second!.text).toBe('Get Started')

      const heroId = first!.id
      const ctaId = second!.id

      // 2. Reorder blocks and add a new block
      const updated = await adapter.update({
        collection: pagesCollection,
        id: created.id,
        data: {
          layout: [
            {
              id: ctaId,
              blockType: 'cta',
              text: 'Sign Up Now',
              buttonUrl: 'https://example.com/signup',
            },
            { id: heroId, blockType: 'hero', heading: 'Welcome (Now Second)' },
            { blockType: 'hero', heading: 'Another Hero' },
          ],
        },
      })
      const updatedBlocks = updated?.layout as Array<{
        id: string
        blockType: string
        heading?: string
        text?: string
        buttonUrl?: string
      }>
      expect(updatedBlocks).toHaveLength(3)
      const [b1, b2, b3] = updatedBlocks
      expect(b1!.id).toBe(ctaId)
      expect(b1!.blockType).toBe('cta')
      expect(b1!.text).toBe('Sign Up Now')
      expect(b2!.id).toBe(heroId)
      expect(b2!.blockType).toBe('hero')
      expect(b3!.id).toMatch(/^[0-9a-f]{16}$/)
      expect(b3!.blockType).toBe('hero')
      expect(b3!.heading).toBe('Another Hero')

      // 3. Rollback on failure
      await expect(
        adapter.transaction!(async (tx) => {
          await tx.update({
            collection: pagesCollection,
            id: created.id,
            data: {
              layout: [],
            },
          })
          throw new Error('Forced rollback')
        }),
      ).rejects.toThrow('Forced rollback')

      const afterRollback = await adapter.findByID({
        collection: pagesCollection,
        id: created.id,
      })
      expect(afterRollback?.layout).toEqual(updatedBlocks)
    })

    testCase('stores and retrieves relationships inside group, array, and blocks', async () => {
      // 1. Create a referenced post
      const post1 = await adapter.create({
        collection: postsCollection,
        data: {
          title: 'Referenced Post 1',
        },
      })
      const post2 = await adapter.create({
        collection: postsCollection,
        data: {
          title: 'Referenced Post 2',
        },
      })

      // 2. Create a page with references in seo, gallery, and layout
      const page = await adapter.create({
        collection: nestedCollection,
        data: {
          title: 'Complex Nested Page',
          seo: {
            metaTitle: 'SEO Meta',
            featuredPost: post1.id,
          },
          gallery: [
            {
              caption: 'First photo',
              featuredPost: post2.id,
            },
          ],
          layout: [
            {
              blockType: 'hero',
              heading: 'Hero Heading',
              featuredPost: post1.id,
            },
            {
              blockType: 'cta',
              text: 'CTA Text',
              buttonUrl: '/cta',
              relatedPosts: [post1.id, post2.id],
            },
          ],
        },
      })

      expect(page.id).toBeDefined()
      const verifyDoc = (doc: Record<string, unknown>, p1: number, p2: number) => {
        const seo = doc.seo as Record<string, unknown>
        const gallery = doc.gallery as Array<Record<string, unknown>>
        const layout = doc.layout as Array<Record<string, unknown>>
        expect(seo.featuredPost).toBe(p1)
        expect(gallery[0]!.featuredPost).toBe(p2)
        expect(layout[0]!.featuredPost).toBe(p1)
        expect(layout[1]!.relatedPosts).toEqual([p1, p2])
      }
      verifyDoc(page, post1.id, post2.id)

      // 3. Retrieve using findByID
      const fetched = await adapter.findByID({
        collection: nestedCollection,
        id: page.id,
      })
      expect(fetched).not.toBeNull()
      verifyDoc(fetched!, post1.id, post2.id)

      // 4. Update references inside nested fields
      const layoutBlocks = page.layout as Array<Record<string, unknown>>
      const updated = await adapter.update({
        collection: nestedCollection,
        id: page.id,
        data: {
          seo: {
            metaTitle: 'Updated SEO Meta',
            featuredPost: post2.id,
          },
          layout: [
            {
              id: layoutBlocks[0]!.id as string,
              blockType: 'hero',
              heading: 'Hero Heading Updated',
              featuredPost: null,
            },
          ],
        },
      })
      expect(updated).not.toBeNull()
      const updatedSeo = updated!.seo as Record<string, unknown>
      const updatedLayout = updated!.layout as Array<Record<string, unknown>>
      expect(updatedSeo.featuredPost).toBe(post2.id)
      expect(updatedLayout[0]!.featuredPost).toBeNull()
    })

    testCase('filters and sorts on nested field paths: group, array, and blocks', async () => {
      const pageA = await adapter.create({
        collection: pagesCollection,
        data: {
          title: 'Summer Vacation Unique',
          seo: { metaTitle: 'Summer Trip Unique', metaDescription: 'Sunny beach vacation' },
          gallery: [
            { caption: 'Sunny beach photo', year: 1981 },
            { caption: 'Palm trees photo', year: 1982 },
          ],
          layout: [
            { blockType: 'hero', heading: 'Welcome to Paradise Unique' },
            { blockType: 'cta', text: 'Book Now Unique', buttonUrl: '/book' },
          ],
        },
      })

      const pageB = await adapter.create({
        collection: pagesCollection,
        data: {
          title: 'Winter Cabin Unique',
          seo: { metaTitle: 'Winter Retreat Unique', metaDescription: 'Snowy cabin in the woods' },
          gallery: [{ caption: 'Snow mountain photo', year: 1983 }],
          layout: [{ blockType: 'hero', heading: 'Cozy Winter Escape Unique' }],
        },
      })

      const pageC = await adapter.create({
        collection: pagesCollection,
        data: {
          title: 'Autumn Harvest Unique',
        },
      })

      // 1. Group filtering: dot notation and nested object
      const resGroupDot = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { 'seo.metaTitle': { equals: 'Summer Trip Unique' } },
      })
      expect(resGroupDot.docs.map((d) => d.id)).toEqual([pageA.id])

      const resGroupNested = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { seo: { metaTitle: { equals: 'Winter Retreat Unique' } } },
      })
      expect(resGroupNested.docs.map((d) => d.id)).toEqual([pageB.id])

      // 2. Group sorting
      const resSortAsc = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { id: { in: [pageA.id, pageB.id, pageC.id] } },
        sort: 'seo.metaTitle',
      })
      expect(resSortAsc.docs.map((d) => d.id)).toEqual([pageC.id, pageA.id, pageB.id])

      const resSortDesc = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { id: { in: [pageA.id, pageB.id, pageC.id] } },
        sort: '-seo.metaTitle',
      })
      expect(resSortDesc.docs.map((d) => d.id)).toEqual([pageB.id, pageA.id, pageC.id])

      // 3. Array filtering
      const resArrayEquals = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { 'gallery.caption': { equals: 'Sunny beach photo' } },
      })
      expect(resArrayEquals.docs.map((d) => d.id)).toEqual([pageA.id])

      const resArrayContains = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { 'gallery.caption': { contains: 'mountain photo' } },
      })
      expect(resArrayContains.docs.map((d) => d.id)).toEqual([pageB.id])

      const resArrayIn = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { 'gallery.year': { in: [1981, 1999] } },
      })
      expect(resArrayIn.docs.map((d) => d.id)).toEqual([pageA.id])

      const resArrayNested = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { gallery: { caption: { equals: 'Snow mountain photo' } } },
      })
      expect(resArrayNested.docs.map((d) => d.id)).toEqual([pageB.id])

      // 4. Blocks filtering
      const resBlocksEquals = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { 'layout.heading': { equals: 'Welcome to Paradise Unique' } },
      })
      expect(resBlocksEquals.docs.map((d) => d.id)).toEqual([pageA.id])

      const resBlocksContains = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { 'layout.heading': { contains: 'Cozy Winter' } },
      })
      expect(resBlocksContains.docs.map((d) => d.id)).toEqual([pageB.id])

      const resBlocksType = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: {
          and: [
            { id: { in: [pageA.id, pageB.id, pageC.id] } },
            { 'layout.blockType': { equals: 'cta' } },
          ],
        },
      })
      expect(resBlocksType.docs.map((d) => d.id)).toEqual([pageA.id])

      const resBlocksCtaText = await adapter.find({
        collection: pagesCollection,
        page: 1,
        limit: 10,
        where: { 'layout.text': { equals: 'Book Now Unique' } },
      })
      expect(resBlocksCtaText.docs.map((d) => d.id)).toEqual([pageA.id])
    })

    testCase(
      'creates and reads documents with conditional required fields on both sides of condition',
      async () => {
        // 1. Create document where condition is false (format: 'standard'), videoUrl is omitted / null
        const standardDoc = await adapter.create({
          collection: conditionalPostsCollection,
          data: {
            title: 'Standard Post',
            format: 'standard',
            videoUrl: null,
          },
        })
        expect(standardDoc.id).toBeDefined()
        expect(standardDoc.title).toBe('Standard Post')
        expect(standardDoc.format).toBe('standard')
        expect(standardDoc.videoUrl).toBeNull()

        const readStandard = await adapter.findByID({
          collection: conditionalPostsCollection,
          id: standardDoc.id,
        })
        expect(readStandard?.videoUrl).toBeNull()

        // 2. Create document where condition is true (format: 'video'), videoUrl is provided
        const videoDoc = await adapter.create({
          collection: conditionalPostsCollection,
          data: {
            title: 'Video Post',
            format: 'video',
            videoUrl: 'https://example.com/video.mp4',
          },
        })
        expect(videoDoc.id).toBeDefined()
        expect(videoDoc.videoUrl).toBe('https://example.com/video.mp4')

        const readVideo = await adapter.findByID({
          collection: conditionalPostsCollection,
          id: videoDoc.id,
        })
        expect(readVideo?.videoUrl).toBe('https://example.com/video.mp4')

        // 3. Update video doc to standard format: videoUrl is set to null
        const updatedDoc = await adapter.update({
          collection: conditionalPostsCollection,
          id: videoDoc.id,
          data: {
            format: 'standard',
            videoUrl: null,
          },
        })
        expect(updatedDoc).not.toBeNull()
        expect(updatedDoc?.format).toBe('standard')
        expect(updatedDoc?.videoUrl).toBeNull()

        const readUpdated = await adapter.findByID({
          collection: conditionalPostsCollection,
          id: videoDoc.id,
        })
        expect(readUpdated?.videoUrl).toBeNull()
      },
    )

    testCase(
      'filters by block-qualified paths when multiple block types share field names (#171)',
      async () => {
        // Doc 1: has hero with heading "Alpha"
        const doc1 = await adapter.create({
          collection: sharedBlocksCollection,
          data: {
            title: 'Doc 1 - Hero Alpha',
            layout: [{ blockType: 'hero', heading: 'Alpha' }],
          },
        })

        // Doc 2: has section with heading "Alpha"
        const doc2 = await adapter.create({
          collection: sharedBlocksCollection,
          data: {
            title: 'Doc 2 - Section Alpha',
            layout: [{ blockType: 'section', heading: 'Alpha' }],
          },
        })

        // Doc 3: has hero with heading "Beta" and section with heading "Alpha"
        const doc3 = await adapter.create({
          collection: sharedBlocksCollection,
          data: {
            title: 'Doc 3 - Hero Beta & Section Alpha',
            layout: [
              { blockType: 'hero', heading: 'Beta' },
              { blockType: 'section', heading: 'Alpha' },
            ],
          },
        })

        // 1. Unqualified filter matches any block with heading = 'Alpha' (Doc 1, Doc 2, Doc 3)
        const unqualified = await adapter.find({
          collection: sharedBlocksCollection,
          page: 1,
          limit: 10,
          where: { 'layout.heading': { equals: 'Alpha' } },
        })
        expect(unqualified.docs.map((d) => d.id).sort()).toEqual([doc1.id, doc2.id, doc3.id].sort())

        // 2. Block-qualified filter with dot notation: layout.hero.heading = 'Alpha'
        // Matches ONLY Doc 1 (Doc 2 has no hero, Doc 3 hero heading is 'Beta')
        const heroDot = await adapter.find({
          collection: sharedBlocksCollection,
          page: 1,
          limit: 10,
          where: { 'layout.hero.heading': { equals: 'Alpha' } },
        })
        expect(heroDot.docs.map((d) => d.id)).toEqual([doc1.id])

        // 3. Block-qualified filter with double-underscore notation: layout__hero__heading = 'Alpha'
        const heroUnder = await adapter.find({
          collection: sharedBlocksCollection,
          page: 1,
          limit: 10,
          where: { layout__hero__heading: { equals: 'Alpha' } },
        })
        expect(heroUnder.docs.map((d) => d.id)).toEqual([doc1.id])

        // 4. Block-qualified filter on section: layout.section.heading = 'Alpha'
        // Matches Doc 2 and Doc 3
        const sectionDot = await adapter.find({
          collection: sharedBlocksCollection,
          page: 1,
          limit: 10,
          where: { 'layout.section.heading': { equals: 'Alpha' } },
        })
        expect(sectionDot.docs.map((d) => d.id).sort()).toEqual([doc2.id, doc3.id].sort())

        // 5. Block-qualified filter with in operator
        const heroIn = await adapter.find({
          collection: sharedBlocksCollection,
          page: 1,
          limit: 10,
          where: { 'layout.hero.heading': { in: ['Alpha', 'Beta'] } },
        })
        expect(heroIn.docs.map((d) => d.id).sort()).toEqual([doc1.id, doc3.id].sort())

        // 6. Block-qualified filter with contains operator
        const heroContains = await adapter.find({
          collection: sharedBlocksCollection,
          page: 1,
          limit: 10,
          where: { 'layout.hero.heading': { contains: 'Alph' } },
        })
        expect(heroContains.docs.map((d) => d.id)).toEqual([doc1.id])

        // 7. Block-qualified filter with not_equals operator
        const heroNotEquals = await adapter.find({
          collection: sharedBlocksCollection,
          page: 1,
          limit: 10,
          where: { 'layout.hero.heading': { not_equals: 'Alpha' } },
        })
        expect(heroNotEquals.docs.map((d) => d.id).sort()).toEqual([doc2.id, doc3.id].sort())
      },
    )

    testCase('generates row ids recursively for nested array and block items (#176)', async () => {
      // Create with NO row ids anywhere
      const created = await adapter.create({
        collection: nestedCollection,
        data: {
          title: 'Nested Array Test',
          gallery: [
            {
              caption: 'First photo',
              tags: [{ name: 'nature' }, { name: 'landscape' }],
            },
          ],
          layout: [
            {
              blockType: 'galleryBlock',
              images: [{ caption: 'Image 1' }, { caption: 'Image 2' }],
            },
          ],
        },
      })

      type LayoutItem = {
        id: string
        blockType: string
        images: Array<{ id: string; caption: string }>
      }
      type GalleryItem = {
        id: string
        caption: string
        tags: Array<{ id: string; name: string }>
      }

      const createdLayout = created.layout as LayoutItem[]
      const firstBlock = createdLayout[0]!
      const img1 = firstBlock.images[0]!
      const img2 = firstBlock.images[1]!
      expect(firstBlock.id).toBeDefined()
      expect(firstBlock.images).toHaveLength(2)
      expect(img1.id).toBeDefined()
      expect(img2.id).toBeDefined()
      expect(img1.id).not.toBe(img2.id)

      const createdGallery = created.gallery as GalleryItem[]
      const firstGallery = createdGallery[0]!
      const tag1 = firstGallery.tags[0]!
      const tag2 = firstGallery.tags[1]!
      expect(firstGallery.id).toBeDefined()
      expect(firstGallery.tags).toHaveLength(2)
      expect(tag1.id).toBeDefined()
      expect(tag2.id).toBeDefined()
      expect(tag1.id).not.toBe(tag2.id)

      // Update: add a new image without an id, keep the first image with its existing id
      const existingImage0Id = img1.id
      const updated = await adapter.update({
        collection: nestedCollection,
        id: created.id,
        data: {
          layout: [
            {
              id: firstBlock.id,
              blockType: 'galleryBlock',
              images: [
                { id: existingImage0Id, caption: 'Image 1 Updated' },
                { caption: 'Image 3 New' },
              ],
            },
          ],
        },
      })

      const updatedLayout = (updated?.layout ?? []) as LayoutItem[]
      const updatedFirstBlock = updatedLayout[0]!
      const updImg1 = updatedFirstBlock.images[0]!
      const updImg2 = updatedFirstBlock.images[1]!
      expect(updatedFirstBlock.id).toBe(firstBlock.id)
      expect(updatedFirstBlock.images).toHaveLength(2)
      expect(updImg1.id).toBe(existingImage0Id)
      expect(updImg2.id).toBeDefined()
      expect(updImg2.id).not.toBe(existingImage0Id)
    })

    testCase(
      'filters array and blocks with not_equals without dropping documents missing the key or with empty/null arrays (#179)',
      async () => {
        // 1. Array path filtering with not_equals
        const docMatch = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Sunset Page Match',
            gallery: [{ caption: 'sunset', year: 2021 }],
          },
        })
        const docDiff = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Sunrise Page Diff',
            gallery: [{ caption: 'sunrise', year: 2022 }],
          },
        })
        const docKeyAbsent = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'No Caption Page',
            gallery: [{ year: 2023 }],
          },
        })
        const docEmptyArray = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Empty Gallery Page',
            gallery: [],
          },
        })
        const docNullArray = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Null Gallery Page',
            gallery: null,
          },
        })

        const allTestDocIds = [
          docMatch.id,
          docDiff.id,
          docKeyAbsent.id,
          docEmptyArray.id,
          docNullArray.id,
        ]

        const resArrayNotEquals = await adapter.find({
          collection: pagesCollection,
          page: 1,
          limit: 10,
          where: {
            and: [{ id: { in: allTestDocIds } }, { 'gallery.caption': { not_equals: 'sunset' } }],
          },
        })

        const returnedIds = resArrayNotEquals.docs.map((d) => d.id).sort()
        const expectedIds = [docDiff.id, docKeyAbsent.id, docEmptyArray.id, docNullArray.id].sort()
        expect(returnedIds).toEqual(expectedIds)

        // 2. Blocks path filtering with not_equals (both unqualified and block-qualified)
        const blockMatch = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Block Hero Match',
            layout: [{ blockType: 'hero', heading: 'Alpha' }],
          },
        })
        const blockDiff = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Block Hero Diff',
            layout: [{ blockType: 'hero', heading: 'Beta' }],
          },
        })
        const blockKeyAbsent = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Block Key Absent',
            layout: [{ blockType: 'cta', text: 'Click Here' }],
          },
        })
        const blockEmpty = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Block Empty',
            layout: [],
          },
        })
        const blockNull = await adapter.create({
          collection: pagesCollection,
          data: {
            title: 'Block Null',
            layout: null,
          },
        })

        const allBlockDocIds = [
          blockMatch.id,
          blockDiff.id,
          blockKeyAbsent.id,
          blockEmpty.id,
          blockNull.id,
        ]

        // Block-qualified path (layout.hero.heading)
        const resQualified = await adapter.find({
          collection: pagesCollection,
          page: 1,
          limit: 10,
          where: {
            and: [
              { id: { in: allBlockDocIds } },
              { 'layout.hero.heading': { not_equals: 'Alpha' } },
            ],
          },
        })
        expect(resQualified.docs.map((d) => d.id).sort()).toEqual(
          [blockDiff.id, blockKeyAbsent.id, blockEmpty.id, blockNull.id].sort(),
        )

        // Unqualified path (layout.heading)
        const resUnqualified = await adapter.find({
          collection: pagesCollection,
          page: 1,
          limit: 10,
          where: {
            and: [{ id: { in: allBlockDocIds } }, { 'layout.heading': { not_equals: 'Alpha' } }],
          },
        })
        expect(resUnqualified.docs.map((d) => d.id).sort()).toEqual(
          [blockDiff.id, blockKeyAbsent.id, blockEmpty.id, blockNull.id].sort(),
        )
      },
    )

    testCase(
      'manages version history, autosave in-place updates, pruning, and cascade deletes',
      async () => {
        // 1. Create parent doc
        const parentDoc = await adapter.create({
          collection: versionedPostsCollection,
          data: {
            title: 'Initial Versioned Post',
            content: 'Original content',
            _status: 'published',
          },
        })

        // 2. Save version 1
        const v1 = await adapter.saveVersion!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
          snapshot: { ...parentDoc },
          status: 'published',
          userId: 'user-1',
        })
        expect(v1.versionNumber).toBe(1)
        expect(v1.snapshot.title).toBe('Initial Versioned Post')
        expect(v1._status).toBe('published')
        expect(v1.autosave).toBe(false)
        expect(v1.createdBy).toBe('user-1')

        // 3. Save draft with autosave: true
        const v2 = await adapter.saveVersion!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
          snapshot: { ...parentDoc, title: 'Draft v1' },
          status: 'draft',
          autosave: true,
          userId: 'user-1',
        })
        expect(v2.versionNumber).toBe(2)
        expect(v2.snapshot.title).toBe('Draft v1')
        expect(v2.autosave).toBe(true)

        // 4. Continuous autosave updates the row in place
        const v2Updated = await adapter.saveVersion!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
          snapshot: { ...parentDoc, title: 'Draft v2 (autosaved)' },
          status: 'draft',
          autosave: true,
          userId: 'user-2',
        })
        expect(v2Updated.id).toBe(v2.id)
        expect(v2Updated.snapshot.title).toBe('Draft v2 (autosaved)')
        expect(v2Updated.createdBy).toBe('user-2')

        // 5. Query latest draft version
        const latestDraft = await adapter.findLatestDraftVersion!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
        })
        expect(latestDraft).not.toBeNull()
        expect(latestDraft?.snapshot.title).toBe('Draft v2 (autosaved)')

        // 6. Test retention pruning (maxPerDoc: 2). Adding version 3 should prune v1.
        const v3 = await adapter.saveVersion!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
          snapshot: { ...parentDoc, title: 'Published v3' },
          status: 'published',
        })
        expect(v3.versionNumber).toBe(3)

        const history = await adapter.findVersions!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
        })
        expect(history.totalDocs).toBe(2)
        expect(history.docs.map((d) => d.id)).not.toContain(v1.id)

        // 7. Find version by ID
        const foundV3 = await adapter.findVersionByID!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
          versionId: v3.id,
        })
        expect(foundV3).not.toBeNull()
        expect(foundV3?.snapshot.title).toBe('Published v3')

        // 8. Test database cascade delete (ON DELETE CASCADE)
        await adapter.delete({
          collection: versionedPostsCollection,
          id: parentDoc.id,
        })

        const remainingVersions = await adapter.findVersions!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
        })
        expect(remainingVersions.totalDocs).toBe(0)
      },
    )

    testCase(
      'guarantees continuous autosaves generate at most one transient version row without exhausting retention (#203)',
      async () => {
        const parentDoc = await adapter.create({
          collection: versionedPostsCollection,
          data: {
            title: 'Initial Document',
            content: 'Original body',
            _status: 'published',
          },
        })

        // 20 continuous autosaves
        let lastAutosaveId: number | undefined
        for (let i = 1; i <= 20; i++) {
          const v = await adapter.saveVersion!({
            collection: versionedPostsCollection,
            parentId: parentDoc.id,
            snapshot: { ...parentDoc, title: `Autosave iteration ${i}` },
            status: 'draft',
            autosave: true,
          })
          if (lastAutosaveId === undefined) {
            lastAutosaveId = v.id
          } else {
            expect(v.id).toBe(lastAutosaveId) // In-place row update
          }
        }

        const versionsAfterAutosaves = await adapter.findVersions!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
        })
        expect(versionsAfterAutosaves.totalDocs).toBe(1)
        expect(versionsAfterAutosaves.docs[0]?.autosave).toBe(true)
        expect(versionsAfterAutosaves.docs[0]?.snapshot.title).toBe('Autosave iteration 20')

        // An explicit manual draft creates a permanent row with autosave: false
        const manualDraft = await adapter.saveVersion!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
          snapshot: { ...parentDoc, title: 'Manual Draft' },
          status: 'draft',
          autosave: false,
        })
        expect(manualDraft.id).not.toBe(lastAutosaveId)
        expect(manualDraft.autosave).toBe(false)

        const versionsAfterManual = await adapter.findVersions!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
        })
        expect(versionsAfterManual.totalDocs).toBe(2)

        // Further continuous autosaves now create one new autosave row and update it in place
        let secondAutosaveId: number | undefined
        for (let i = 1; i <= 10; i++) {
          const v = await adapter.saveVersion!({
            collection: versionedPostsCollection,
            parentId: parentDoc.id,
            snapshot: { ...parentDoc, title: `Second session autosave ${i}` },
            status: 'draft',
            autosave: true,
          })
          if (secondAutosaveId === undefined) {
            secondAutosaveId = v.id
          } else {
            expect(v.id).toBe(secondAutosaveId)
          }
        }

        const versionsFinal = await adapter.findVersions!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
        })
        // Exactly 2 rows retained per maxPerDoc: 2 (the manual draft and the second session autosave)
        expect(versionsFinal.totalDocs).toBe(2)
        expect(versionsFinal.docs.map((d) => d.id)).toEqual([secondAutosaveId, manualDraft.id])
      },
    )

    testCase(
      'manages global version history, autosave in-place updates, draft querying, and retention pruning',
      async () => {
        // 1. Initial global doc
        const saved = await adapter.updateGlobal({
          global: versionedSettingsGlobal,
          data: {
            siteName: 'Original Site Name',
            tagline: 'Just another CMS',
            _status: 'published',
          },
        })
        expect(saved.id).toBe(1)
        expect(saved.siteName).toBe('Original Site Name')

        // 2. Save version 1 (published)
        const v1 = await adapter.saveVersion!({
          global: versionedSettingsGlobal,
          parentId: 1,
          snapshot: { ...saved },
          status: 'published',
          userId: 'user-admin',
        })
        expect(v1.versionNumber).toBe(1)
        expect(v1.snapshot.siteName).toBe('Original Site Name')
        expect(v1._status).toBe('published')
        expect(v1.autosave).toBe(false)
        expect(v1.createdBy).toBe('user-admin')

        // 3. Save draft version with autosave: true
        const v2 = await adapter.saveVersion!({
          global: versionedSettingsGlobal,
          parentId: 1,
          snapshot: { ...saved, siteName: 'Draft Site Name 1' },
          status: 'draft',
          autosave: true,
          userId: 'user-admin',
        })
        expect(v2.versionNumber).toBe(2)
        expect(v2.snapshot.siteName).toBe('Draft Site Name 1')
        expect(v2.autosave).toBe(true)

        // 4. Repeated autosave updates row in place
        const v2Updated = await adapter.saveVersion!({
          global: versionedSettingsGlobal,
          parentId: 1,
          snapshot: { ...saved, siteName: 'Draft Site Name 2 (autosaved)' },
          status: 'draft',
          autosave: true,
          userId: 'user-editor',
        })
        expect(v2Updated.id).toBe(v2.id)
        expect(v2Updated.snapshot.siteName).toBe('Draft Site Name 2 (autosaved)')
        expect(v2Updated.createdBy).toBe('user-editor')

        // 5. Query latest draft version
        const latestDraft = await adapter.findLatestDraftVersion!({
          global: versionedSettingsGlobal,
          parentId: 1,
        })
        expect(latestDraft).not.toBeNull()
        expect(latestDraft?.snapshot.siteName).toBe('Draft Site Name 2 (autosaved)')

        // 6. Query versions list with pagination
        const versionsList = await adapter.findVersions!({
          global: versionedSettingsGlobal,
          parentId: 1,
          page: 1,
          limit: 10,
        })
        expect(versionsList.totalDocs).toBe(2)
        expect(versionsList.docs[0]?.id).toBe(v2.id)
        expect(versionsList.docs[1]?.id).toBe(v1.id)

        // 7. Find version by ID
        const foundV2 = await adapter.findVersionByID!({
          global: versionedSettingsGlobal,
          versionId: v2.id,
        })
        expect(foundV2).not.toBeNull()
        expect(foundV2?.id).toBe(v2.id)
        expect(foundV2?.snapshot.siteName).toBe('Draft Site Name 2 (autosaved)')

        // 8. Test retention pruning (maxPerDoc: 2). Adding version 3 should prune v1.
        const v3 = await adapter.saveVersion!({
          global: versionedSettingsGlobal,
          parentId: 1,
          snapshot: { ...saved, siteName: 'Published Site Name v3' },
          status: 'published',
        })
        expect(v3.versionNumber).toBe(3)

        const versionsAfterPrune = await adapter.findVersions!({
          global: versionedSettingsGlobal,
          parentId: 1,
        })
        expect(versionsAfterPrune.totalDocs).toBe(2)
        expect(versionsAfterPrune.docs.map((d) => d.id)).toEqual([v3.id, v2.id])
      },
    )

    testCase('supports sorting on findVersions (#243)', async () => {
      const parentDoc = await adapter.create({
        collection: versionHistoryCollection,
        data: {
          title: 'Sortable Document',
          content: 'Original content',
          _status: 'published',
        },
      })

      const v1 = await adapter.saveVersion!({
        collection: versionHistoryCollection,
        parentId: parentDoc.id,
        snapshot: { ...parentDoc, title: 'Sort Post v1' },
        status: 'published',
      })
      const v2 = await adapter.saveVersion!({
        collection: versionHistoryCollection,
        parentId: parentDoc.id,
        snapshot: { ...parentDoc, title: 'Sort Post v2' },
        status: 'published',
      })
      const v3 = await adapter.saveVersion!({
        collection: versionHistoryCollection,
        parentId: parentDoc.id,
        snapshot: { ...parentDoc, title: 'Sort Post v3' },
        status: 'draft',
      })

      // Default without sort: newest first (id desc)
      const defaultList = await adapter.findVersions!({
        collection: versionHistoryCollection,
        parentId: parentDoc.id,
      })
      expect(defaultList.docs.map((d) => d.id)).toEqual([v3.id, v2.id, v1.id])

      // Ascending by versionNumber
      const ascList = await adapter.findVersions!({
        collection: versionHistoryCollection,
        parentId: parentDoc.id,
        sort: 'versionNumber',
      })
      expect(ascList.docs.map((d) => d.id)).toEqual([v1.id, v2.id, v3.id])

      // Descending by versionNumber
      const descList = await adapter.findVersions!({
        collection: versionHistoryCollection,
        parentId: parentDoc.id,
        sort: '-versionNumber',
      })
      expect(descList.docs.map((d) => d.id)).toEqual([v3.id, v2.id, v1.id])
    })

    testCase(
      'does not collapse into an autosave row when incoming save has status: published (#243)',
      async () => {
        const parentDoc = await adapter.create({
          collection: versionHistoryCollection,
          data: {
            title: 'Draft Post Document',
            content: 'Initial text',
            _status: 'published',
          },
        })

        // 1. Initial draft autosave
        const draftAutosave = await adapter.saveVersion!({
          collection: versionHistoryCollection,
          parentId: parentDoc.id,
          snapshot: { ...parentDoc, title: 'Unsaved Draft' },
          status: 'draft',
          autosave: true,
        })
        expect(draftAutosave._status).toBe('draft')
        expect(draftAutosave.autosave).toBe(true)

        // 2. Incoming save with autosave: true but status: 'published'
        const publishedSave = await adapter.saveVersion!({
          collection: versionHistoryCollection,
          parentId: parentDoc.id,
          snapshot: { ...parentDoc, title: 'Published Save' },
          status: 'published',
          autosave: true,
        })
        expect(publishedSave.id).not.toBe(draftAutosave.id)
        expect(publishedSave.versionNumber).toBe(draftAutosave.versionNumber + 1)
        expect(publishedSave._status).toBe('published')

        // 3. findLatestDraftVersion correctly returns null because the latest version is published (no phantom draft)
        const latestDraft = await adapter.findLatestDraftVersion!({
          collection: versionHistoryCollection,
          parentId: parentDoc.id,
        })
        expect(latestDraft).toBeNull()

        // 4. Both versions exist independently in history without overwriting
        const versions = await adapter.findVersions!({
          collection: versionHistoryCollection,
          parentId: parentDoc.id,
          sort: 'versionNumber',
        })
        expect(versions.totalDocs).toBe(2)
        expect(versions.docs[0]?.id).toBe(draftAutosave.id)
        expect(versions.docs[0]?._status).toBe('draft')
        expect(versions.docs[0]?.snapshot.title).toBe('Unsaved Draft')
        expect(versions.docs[1]?.id).toBe(publishedSave.id)
        expect(versions.docs[1]?._status).toBe('published')
        expect(versions.docs[1]?.snapshot.title).toBe('Published Save')
      },
    )

    testCase('serializes concurrent version saves on the same parent document (#243)', async () => {
      const parentDoc = await adapter.create({
        collection: versionHistoryCollection,
        data: {
          title: 'Concurrent Document',
          content: 'Concurrent content',
          _status: 'published',
        },
      })

      // Run 5 saves in parallel inside transactions
      const saves = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          adapter.transaction!(async (txAdapter) => {
            return txAdapter.saveVersion!({
              collection: versionHistoryCollection,
              parentId: parentDoc.id,
              snapshot: { ...parentDoc, title: `Concurrent Save ${i + 1}` },
              status: 'published',
            })
          }),
        ),
      )

      const versionNumbers = saves.map((s) => s.versionNumber).sort((a, b) => a - b)
      expect(versionNumbers).toEqual([1, 2, 3, 4, 5])

      const versions = await adapter.findVersions!({
        collection: versionHistoryCollection,
        parentId: parentDoc.id,
        sort: 'versionNumber',
      })
      expect(versions.totalDocs).toBe(5)
      expect(versions.docs.map((d) => d.versionNumber)).toEqual([1, 2, 3, 4, 5])
    })

    testCase(
      'checks if a filename is referenced in any version snapshot via hasVersionWithFilename',
      async () => {
        const parentDoc = await adapter.create({
          collection: versionedPostsCollection,
          data: { title: 'Upload Doc' },
        })

        await adapter.saveVersion!({
          collection: versionedPostsCollection,
          parentId: parentDoc.id,
          snapshot: { ...parentDoc, filename: 'draft-file.png' },
          status: 'draft',
        })

        expect(
          await adapter.hasVersionWithFilename!({
            collection: versionedPostsCollection,
            filename: 'draft-file.png',
          }),
        ).toBe(true)

        expect(
          await adapter.hasVersionWithFilename!({
            collection: versionedPostsCollection,
            filename: 'nonexistent-file.png',
          }),
        ).toBe(false)
      },
    )

    testCase(`publish of a missing id returns 404 on real ${adapterLabel}`, async () => {
      const app = createLontar(config)
      const res = await app.request('/api/versioned_posts/999999/publish', { method: 'POST' })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('not found')
    })

    testCase(
      `publish of an invalid draft returns 400 with issues on real ${adapterLabel}`,
      async () => {
        const app = createLontar(config)
        // 1. Create a valid doc
        const doc = await adapter.create({
          collection: versionedPostsCollection,
          data: { title: 'Initial Post', content: 'Draft content' },
        })

        // 2. Save an invalid draft version snapshot (e.g. empty required title)
        await adapter.saveVersion!({
          collection: versionedPostsCollection,
          parentId: doc.id,
          snapshot: { ...doc, title: '' },
          status: 'draft',
        })

        // 3. Attempt to publish invalid draft -> 400 with issues
        const pubRes = await app.request(`/api/versioned_posts/${doc.id}/publish`, {
          method: 'POST',
        })
        expect(pubRes.status).toBe(400)
        const pubBody = (await pubRes.json()) as { error: string; issues: unknown[] }
        expect(pubBody.error).toBe('Validation failed')
        expect(pubBody.issues).toBeDefined()
        expect(pubBody.issues.length).toBeGreaterThan(0)
      },
    )

    testCase(`publish of an unknown global returns 404 on real ${adapterLabel}`, async () => {
      const app = createLontar(config)
      const res = await app.request('/api/globals/nonexistent_global/publish', { method: 'POST' })
      expect(res.status).toBe(404)
    })

    testCase(
      `publish of an invalid draft global returns 400 with issues on real ${adapterLabel}`,
      async () => {
        const app = createLontar(config)
        // 1. Initialize global
        const globalDoc = await adapter.updateGlobal({
          global: versionedSettingsGlobal,
          data: { siteName: 'Initial Site', tagline: 'Live' },
        })

        // 2. Save an invalid draft version snapshot (e.g. empty required siteName)
        await adapter.saveVersion!({
          global: versionedSettingsGlobal,
          parentId: 1,
          snapshot: { ...globalDoc, siteName: '' },
          status: 'draft',
        })

        // 3. Attempt to publish invalid global draft -> 400 with issues
        const pubRes = await app.request('/api/globals/versioned_settings/publish', {
          method: 'POST',
        })
        expect(pubRes.status).toBe(400)
        const pubBody = (await pubRes.json()) as { error: string; issues: unknown[] }
        expect(pubBody.error).toBe('Validation failed')
        expect(pubBody.issues).toBeDefined()
        expect(pubBody.issues.length).toBeGreaterThan(0)
      },
    )

    testCase(
      'creates and versions documents on a collection with a long slug (> 37 chars) whose index names are capped',
      async () => {
        const doc = await adapter.create({
          collection: longSlugVersionedCollection,
          data: { title: 'Long Slug Doc', _status: 'published' },
        })
        expect(doc.id).toBeDefined()

        const version = await adapter.saveVersion!({
          collection: longSlugVersionedCollection,
          parentId: doc.id,
          snapshot: { ...doc, title: 'Draft Long Slug' },
          status: 'draft',
        })
        expect(version.versionNumber).toBe(1)
        expect(version.snapshot.title).toBe('Draft Long Slug')

        const latest = await adapter.findLatestDraftVersion!({
          collection: longSlugVersionedCollection,
          parentId: doc.id,
        })
        expect(latest).not.toBeNull()
        expect(latest?.snapshot.title).toBe('Draft Long Slug')
      },
    )

    describe('localization', () => {
      testCase('reads localized values with requested locale and fallback', async () => {
        const doc = await adapter.create({
          collection: localizedPostsCollection,
          data: {
            title: 'English Title',
            slug: 'en-title',
            content: { type: 'doc', content: [{ type: 'paragraph', text: 'Hello' }] },
          },
          locale: 'en',
        })
        expect(doc.id).toBeDefined()

        // Update in 'id' with title and slug, leave content empty
        await adapter.update({
          collection: localizedPostsCollection,
          id: doc.id,
          data: {
            title: 'Judul Indonesia',
            slug: 'judul-id',
          },
          locale: 'id',
        })

        // Read with locale = 'en'
        const enDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'en',
        })
        expect(enDoc).not.toBeNull()
        expect(enDoc!.title).toBe('English Title')
        expect(enDoc!.slug).toBe('en-title')
        expect(enDoc!.content).toEqual({
          type: 'doc',
          content: [{ type: 'paragraph', text: 'Hello' }],
        })

        // Read with locale = 'id' (content falls back to 'en')
        const idDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'id',
        })
        expect(idDoc).not.toBeNull()
        expect(idDoc!.title).toBe('Judul Indonesia')
        expect(idDoc!.slug).toBe('judul-id')
        expect(idDoc!.content).toEqual({
          type: 'doc',
          content: [{ type: 'paragraph', text: 'Hello' }],
        })
      })

      testCase('reads localized values with fallbackLocale: false and locale = all', async () => {
        const doc = await adapter.create({
          collection: localizedPostsCollection,
          data: {
            title: 'English Title',
            slug: 'en-title-2',
            content: { type: 'doc', content: [{ type: 'paragraph', text: 'Hello' }] },
          },
          locale: 'en',
        })

        await adapter.update({
          collection: localizedPostsCollection,
          id: doc.id,
          data: {
            title: 'Judul Indonesia',
            slug: 'judul-id-2',
          },
          locale: 'id',
        })

        // Read with locale = 'id' and fallbackLocale = false (no fallback for content)
        const noFbDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'id',
          fallbackLocale: false,
        })
        expect(noFbDoc).not.toBeNull()
        expect(noFbDoc!.title).toBe('Judul Indonesia')
        expect(noFbDoc!.content).toBeNull()

        // Read with locale = 'all'
        const allDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'all',
        })
        expect(allDoc).not.toBeNull()
        expect(allDoc!.title).toEqual({
          en: 'English Title',
          id: 'Judul Indonesia',
        })
        expect(allDoc!.slug).toEqual({
          en: 'en-title-2',
          id: 'judul-id-2',
        })
        expect(allDoc!.content).toEqual({
          en: { type: 'doc', content: [{ type: 'paragraph', text: 'Hello' }] },
          id: null,
        })
      })

      testCase('writing to a single locale leaves other locales intact', async () => {
        const doc = await adapter.create({
          collection: localizedPostsCollection,
          data: {
            title: 'Initial EN',
            slug: 'single-locale-slug',
          },
          locale: 'en',
        })

        await adapter.update({
          collection: localizedPostsCollection,
          id: doc.id,
          data: {
            title: 'Initial ID',
          },
          locale: 'id',
        })

        const enDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'en',
        })
        expect(enDoc?.title).toBe('Initial EN')

        const idDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'id',
        })
        expect(idDoc?.title).toBe('Initial ID')
      })

      testCase('writing with locale = all writes multiple locales at once', async () => {
        const doc = await adapter.create({
          collection: localizedPostsCollection,
          data: {
            title: { en: 'Multi EN', id: 'Multi ID' },
            slug: { en: 'multi-en', id: 'multi-id' },
          },
          locale: 'all',
        })

        const enDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'en',
        })
        expect(enDoc?.title).toBe('Multi EN')
        expect(enDoc?.slug).toBe('multi-en')

        const idDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'id',
        })
        expect(idDoc?.title).toBe('Multi ID')
        expect(idDoc?.slug).toBe('multi-id')

        const allDoc = await adapter.findByID({
          collection: localizedPostsCollection,
          id: doc.id,
          locale: 'all',
        })
        expect(allDoc?.title).toEqual({ en: 'Multi EN', id: 'Multi ID' })
      })

      testCase(
        'where filtering on localized fields resolves against requested locale without fallback',
        async () => {
          const doc1 = await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: { en: 'Apple', id: 'Apel' },
              slug: { en: 'apple-fruit', id: 'apel-buah' },
            },
            locale: 'all',
          })

          const doc2 = await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: { en: 'Apel', id: 'Pohon' },
              slug: { en: 'apel-tree', id: 'pohon-apel' },
            },
            locale: 'all',
          })

          // Filter with locale: 'id', title: 'Apel' -> should only match doc1
          const resId = await adapter.find({
            collection: localizedPostsCollection,
            where: { title: { equals: 'Apel' } },
            limit: 10,
            page: 1,
            locale: 'id',
          })
          expect(resId.docs).toHaveLength(1)
          expect(resId.docs[0]!.id).toBe(doc1.id)

          // Filter with locale: 'id', title: 'Apple' -> should match 0 docs (no fallback on filters)
          const resNoFb = await adapter.find({
            collection: localizedPostsCollection,
            where: { title: { equals: 'Apple' } },
            limit: 10,
            page: 1,
            locale: 'id',
          })
          expect(resNoFb.docs).toHaveLength(0)

          // Filter with locale: 'en', title: 'Apel' -> should match doc2
          const resEn = await adapter.find({
            collection: localizedPostsCollection,
            where: { title: { equals: 'Apel' } },
            limit: 10,
            page: 1,
            locale: 'en',
          })
          expect(resEn.docs).toHaveLength(1)
          expect(resEn.docs[0]!.id).toBe(doc2.id)
        },
      )

      testCase(
        'where on a locale-suffixed localized blocks path filters by that locale',
        async () => {
          const withHeroInEn = await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: { en: 'Has hero', id: 'Punya hero' },
              slug: { en: 'has-hero', id: 'punya-hero' },
              sections: {
                en: [{ blockType: 'hero', heading: 'Welcome' }],
                id: [{ blockType: 'quote', text: 'Halo' }],
              },
            },
            locale: 'all',
          })
          const quoteOnly = await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: { en: 'Quote only', id: 'Hanya kutipan' },
              slug: { en: 'quote-only', id: 'hanya-kutipan' },
              sections: {
                en: [{ blockType: 'quote', text: 'Hi' }],
                id: [{ blockType: 'hero', heading: 'Selamat datang' }],
              },
            },
            locale: 'all',
          })

          const find = async (where: Where) =>
            (
              await adapter.find({
                collection: localizedPostsCollection,
                where,
                limit: 10,
                page: 1,
                locale: 'en',
              })
            ).docs.map((d) => d.id)

          // The filter must not be dropped, which would return every row.
          expect(await find({ 'sections_en.blockType': { equals: 'hero' } })).toEqual([
            withHeroInEn.id,
          ])
          expect(await find({ 'sections_id.blockType': { equals: 'hero' } })).toEqual([
            quoteOnly.id,
          ])
          expect(await find({ 'sections_en.hero.heading': { equals: 'Welcome' } })).toEqual([
            withHeroInEn.id,
          ])
        },
      )

      testCase('sorting on localized fields resolves against requested locale column', async () => {
        const docA = await adapter.create({
          collection: localizedPostsCollection,
          data: {
            title: { en: 'Banana', id: 'Cokelat' },
            slug: { en: 'banana-sort', id: 'cokelat-sort' },
          },
          locale: 'all',
        })

        const docB = await adapter.create({
          collection: localizedPostsCollection,
          data: {
            title: { en: 'Avocado', id: 'Durian' },
            slug: { en: 'avocado-sort', id: 'durian-sort' },
          },
          locale: 'all',
        })

        // Sort by title ASC in 'en': Avocado (docB) comes before Banana (docA)
        const resEn = await adapter.find({
          collection: localizedPostsCollection,
          where: { id: { in: [docA.id, docB.id] } },
          sort: 'title',
          limit: 10,
          page: 1,
          locale: 'en',
        })
        expect(resEn.docs.map((d) => d.id)).toEqual([docB.id, docA.id])

        // Sort by title ASC in 'id': Cokelat (docA) comes before Durian (docB)
        const resId = await adapter.find({
          collection: localizedPostsCollection,
          where: { id: { in: [docA.id, docB.id] } },
          sort: 'title',
          limit: 10,
          page: 1,
          locale: 'id',
        })
        expect(resId.docs.map((d) => d.id)).toEqual([docA.id, docB.id])
      })

      testCase(
        'localized group fields store per-locale columns and support filtering and fallback',
        async () => {
          const doc = await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: 'Group Post',
              slug: 'group-post',
              seo: { metaTitle: 'EN SEO', metaDescription: 'EN Description' },
            },
            locale: 'en',
          })

          await adapter.update({
            collection: localizedPostsCollection,
            id: doc.id,
            data: {
              seo: { metaTitle: 'ID SEO' },
            },
            locale: 'id',
          })

          // Read in 'id' -> metaTitle is 'ID SEO', metaDescription falls back to 'EN Description'
          const idDoc = await adapter.findByID({
            collection: localizedPostsCollection,
            id: doc.id,
            locale: 'id',
          })
          expect(idDoc?.seo).toEqual({
            metaTitle: 'ID SEO',
            metaDescription: 'EN Description',
          })

          // Read in 'id' with fallbackLocale: false
          const noFbDoc = await adapter.findByID({
            collection: localizedPostsCollection,
            id: doc.id,
            locale: 'id',
            fallbackLocale: false,
          })
          expect(noFbDoc?.seo).toEqual({
            metaTitle: 'ID SEO',
            metaDescription: null,
          })

          // Read in 'all'
          const allDoc = await adapter.findByID({
            collection: localizedPostsCollection,
            id: doc.id,
            locale: 'all',
          })
          expect(allDoc?.seo).toEqual({
            metaTitle: { en: 'EN SEO', id: 'ID SEO' },
            metaDescription: { en: 'EN Description', id: null },
          })

          // Filter on group field
          const filterRes = await adapter.find({
            collection: localizedPostsCollection,
            where: { 'seo.metaTitle': { equals: 'ID SEO' } },
            limit: 10,
            page: 1,
            locale: 'id',
          })
          expect(filterRes.docs).toHaveLength(1)
          expect(filterRes.docs[0]!.id).toBe(doc.id)
        },
      )

      testCase(
        'localized JSON array subfields and blocks support reading, writing, and filtering',
        async () => {
          const doc = await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: 'Complex Nested Doc',
              slug: 'complex-nested-doc',
              gallery: [{ id: 'row1', caption: 'Photo 1', year: 2024 }],
              layout: [{ id: 'blk1', blockType: 'hero', heading: 'Hero EN', subheading: 'Sub EN' }],
            },
            locale: 'en',
          })

          await adapter.update({
            collection: localizedPostsCollection,
            id: doc.id,
            data: {
              gallery: [{ id: 'row1', caption: 'Foto 1', year: 2024 }],
              layout: [{ id: 'blk1', blockType: 'hero', heading: 'Hero ID', subheading: 'Sub EN' }],
            },
            locale: 'id',
          })

          // Read in 'en'
          const enDoc = await adapter.findByID({
            collection: localizedPostsCollection,
            id: doc.id,
            locale: 'en',
          })
          const enGallery = enDoc?.gallery as Array<{ caption: string; year: number }>
          const enLayout = enDoc?.layout as Array<{ heading: string; subheading: string }>
          expect(enGallery[0]!.caption).toBe('Photo 1')
          expect(enLayout[0]!.heading).toBe('Hero EN')

          // Read in 'id'
          const idDoc = await adapter.findByID({
            collection: localizedPostsCollection,
            id: doc.id,
            locale: 'id',
          })
          const idGallery = idDoc?.gallery as Array<{ caption: string; year: number }>
          const idLayout = idDoc?.layout as Array<{ heading: string; subheading: string }>
          expect(idGallery[0]!.caption).toBe('Foto 1')
          expect(idLayout[0]!.heading).toBe('Hero ID')

          // Filter on array localized subfield
          const filterRes = await adapter.find({
            collection: localizedPostsCollection,
            where: { 'gallery.caption': { equals: 'Foto 1' } },
            limit: 10,
            page: 1,
            locale: 'id',
          })
          expect(filterRes.docs).toHaveLength(1)
          expect(filterRes.docs[0]!.id).toBe(doc.id)
        },
      )

      testCase(
        'localized hasMany relationships store and query junction rows with _locale',
        async () => {
          const cat1 = await adapter.create({
            collection: categoriesCollection,
            data: { name: 'Tech' },
          })
          const cat2 = await adapter.create({
            collection: categoriesCollection,
            data: { name: 'News' },
          })
          const cat3 = await adapter.create({
            collection: categoriesCollection,
            data: { name: 'Politik' },
          })

          const post = await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: 'Junction Post',
              slug: 'junction-post',
              categories: [cat1.id, cat2.id],
            },
            locale: 'en',
          })

          await adapter.update({
            collection: localizedPostsCollection,
            id: post.id,
            data: {
              categories: [cat3.id],
            },
            locale: 'id',
          })

          // Read in 'en'
          const enDoc = await adapter.findByID({
            collection: localizedPostsCollection,
            id: post.id,
            locale: 'en',
          })
          expect(enDoc?.categories).toEqual([cat1.id, cat2.id])

          // Read in 'id'
          const idDoc = await adapter.findByID({
            collection: localizedPostsCollection,
            id: post.id,
            locale: 'id',
          })
          expect(idDoc?.categories).toEqual([cat3.id])

          // Read in 'all'
          const allDoc = await adapter.findByID({
            collection: localizedPostsCollection,
            id: post.id,
            locale: 'all',
          })
          expect(allDoc?.categories).toEqual({
            en: [cat1.id, cat2.id],
            id: [cat3.id],
          })

          // Filter by hasMany category with locale 'id'
          const resId = await adapter.find({
            collection: localizedPostsCollection,
            where: { categories: { in: [cat3.id] } },
            limit: 10,
            page: 1,
            locale: 'id',
          })
          expect(resId.docs).toHaveLength(1)
          expect(resId.docs[0]!.id).toBe(post.id)

          // Filter by hasMany category with locale 'en' -> should not match cat3
          const resEn = await adapter.find({
            collection: localizedPostsCollection,
            where: { categories: { in: [cat3.id] } },
            limit: 10,
            page: 1,
            locale: 'en',
          })
          expect(resEn.docs).toHaveLength(0)
        },
      )

      testCase(
        'maps unique constraint violations to UniqueConstraintError with the original field name',
        async () => {
          await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: 'Original English',
              slug: 'unique-slug-test',
            },
            locale: 'en',
          })

          // Duplicate slug in 'en' must throw UniqueConstraintError with field = 'slug'
          let caughtErr: unknown = null
          try {
            await adapter.create({
              collection: localizedPostsCollection,
              data: {
                title: 'Duplicate English',
                slug: 'unique-slug-test',
              },
              locale: 'en',
            })
          } catch (err) {
            caughtErr = err
          }
          expect(caughtErr).toBeInstanceOf(UniqueConstraintError)
          expect((caughtErr as UniqueConstraintError).field).toBe('slug')

          // Creating with the same slug in 'id' is allowed because unique index is per-locale
          const idDoc = await adapter.create({
            collection: localizedPostsCollection,
            data: {
              title: 'Indonesian Same Slug',
              slug: 'unique-slug-test',
            },
            locale: 'id',
          })
          expect(idDoc.id).toBeDefined()
        },
      )

      testCase(
        'localized global singleton supports reading and updating with locale and locale=all',
        async () => {
          await adapter.updateGlobal({
            global: localizedHeaderGlobal,
            data: {
              siteTitle: 'My Website',
              tagline: 'Shared Tagline',
            },
            locale: 'en',
          })

          await adapter.updateGlobal({
            global: localizedHeaderGlobal,
            data: {
              siteTitle: 'Situs Saya',
            },
            locale: 'id',
          })

          const enGlobal = await adapter.findGlobal({
            global: localizedHeaderGlobal,
            locale: 'en',
          })
          expect(enGlobal).not.toBeNull()
          expect(enGlobal!.siteTitle).toBe('My Website')
          expect(enGlobal!.tagline).toBe('Shared Tagline')

          const idGlobal = await adapter.findGlobal({
            global: localizedHeaderGlobal,
            locale: 'id',
          })
          expect(idGlobal).not.toBeNull()
          expect(idGlobal!.siteTitle).toBe('Situs Saya')
          expect(idGlobal!.tagline).toBe('Shared Tagline')

          const allGlobal = await adapter.findGlobal({
            global: localizedHeaderGlobal,
            locale: 'all',
          })
          expect(allGlobal).not.toBeNull()
          expect(allGlobal!.siteTitle).toEqual({
            en: 'My Website',
            id: 'Situs Saya',
          })
          expect(allGlobal!.tagline).toBe('Shared Tagline')
        },
      )
    })

    describe('code field (ADR 0031)', () => {
      testCase('supports creating, reading, updating, and querying code fields', async () => {
        const created = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'Math Helper',
            code: 'export function add(a: number, b: number): number {\n  return a + b;\n}',
          },
        })

        expect(created.id).toBeDefined()
        expect(created.code).toBe(
          'export function add(a: number, b: number): number {\n  return a + b;\n}',
        )
        expect(created.notes).toBe('// note')

        const fetched = await adapter.findByID({
          collection: snippetsCollection,
          id: created.id,
        })
        expect(fetched).not.toBeNull()
        expect(fetched?.code).toBe(
          'export function add(a: number, b: number): number {\n  return a + b;\n}',
        )

        const updated = await adapter.update({
          collection: snippetsCollection,
          id: created.id,
          data: {
            code: 'export function add(a: number, b: number): number { return a + b; }',
            notes: '// updated note',
          },
        })
        expect(updated).not.toBeNull()
        expect(updated!.code).toBe(
          'export function add(a: number, b: number): number { return a + b; }',
        )
        expect(updated!.notes).toBe('// updated note')

        const results = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            code: { contains: 'return a + b' },
          },
        })
        expect(results.docs.some((doc) => doc.id === created.id)).toBe(true)
      })
    })

    describe('json field (ADR 0031)', () => {
      testCase('supports creating, reading, updating, and querying json fields', async () => {
        const created = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'JSON Snippet',
            code: 'const x = 1;',
            metadata: { version: 1, tags: ['alpha', 'beta'], enabled: true },
          },
        })

        expect(created.id).toBeDefined()
        expect(created.metadata).toEqual({
          version: 1,
          tags: ['alpha', 'beta'],
          enabled: true,
        })

        const fetched = await adapter.findByID({
          collection: snippetsCollection,
          id: created.id,
        })
        expect(fetched).not.toBeNull()
        expect(fetched?.metadata).toEqual({
          version: 1,
          tags: ['alpha', 'beta'],
          enabled: true,
        })

        const updated = await adapter.update({
          collection: snippetsCollection,
          id: created.id,
          data: {
            metadata: { version: 2, tags: ['gamma'] },
          },
        })
        expect(updated).not.toBeNull()
        expect(updated?.metadata).toEqual({ version: 2, tags: ['gamma'] })

        const notNullResults = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            metadata: { not_equals: null },
          },
        })
        expect(notNullResults.docs.some((doc) => doc.id === created.id)).toBe(true)

        const nullResults = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            metadata: { equals: null },
          },
        })
        expect(nullResults.docs.some((doc) => doc.id === created.id)).toBe(false)
      })
    })

    describe('radio field (ADR 0031)', () => {
      testCase('supports creating, reading, updating, and querying radio fields', async () => {
        const created = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'Radio Snippet',
            code: 'const r = true;',
            status: 'published',
          },
        })

        expect(created.id).toBeDefined()
        expect(created.status).toBe('published')

        const createdWithDefault = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'Default Status Snippet',
            code: 'const d = true;',
          },
        })
        expect(createdWithDefault.status).toBe('draft')

        const fetched = await adapter.findByID({
          collection: snippetsCollection,
          id: created.id,
        })
        expect(fetched).not.toBeNull()
        expect(fetched?.status).toBe('published')

        const updated = await adapter.update({
          collection: snippetsCollection,
          id: created.id,
          data: {
            status: 'archived',
          },
        })
        expect(updated).not.toBeNull()
        expect(updated?.status).toBe('archived')

        const findEquals = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            status: { equals: 'archived' },
          },
        })
        expect(findEquals.docs.some((doc) => doc.id === created.id)).toBe(true)

        const findIn = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            status: { in: ['draft', 'archived'] },
          },
        })
        expect(findIn.docs.some((doc) => doc.id === created.id)).toBe(true)
        expect(findIn.docs.some((doc) => doc.id === createdWithDefault.id)).toBe(true)

        const findSorted = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          sort: 'status',
        })
        expect(findSorted.docs.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('point field (ADR 0031)', () => {
      testCase('supports creating, reading, updating, and querying point fields', async () => {
        const created = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'Point Snippet',
            code: 'const p = [106.8456, -6.2088];',
            location: [106.8456, -6.2088],
          },
        })

        expect(created.id).toBeDefined()
        expect(created.location).toEqual([106.8456, -6.2088])

        const createdNull = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'Null Point Snippet',
            code: 'const p = null;',
            location: null,
          },
        })
        expect(createdNull.location).toBeNull()

        const fetched = await adapter.findByID({
          collection: snippetsCollection,
          id: created.id,
        })
        expect(fetched).not.toBeNull()
        expect(fetched?.location).toEqual([106.8456, -6.2088])

        const updated = await adapter.update({
          collection: snippetsCollection,
          id: created.id,
          data: {
            location: [107.6191, -6.9175],
          },
        })
        expect(updated).not.toBeNull()
        expect(updated?.location).toEqual([107.6191, -6.9175])

        const findLngGt = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            'location.lng': { greater_than: 107 },
          },
        })
        expect(findLngGt.docs.some((doc) => doc.id === created.id)).toBe(true)

        const findLatLt = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            'location.lat': { less_than: -6.5 },
          },
        })
        expect(findLatLt.docs.some((doc) => doc.id === created.id)).toBe(true)

        const findAlias = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            'location.longitude': { equals: 107.6191 },
          },
        })
        expect(findAlias.docs.some((doc) => doc.id === created.id)).toBe(true)

        const findNull = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            location: null,
          },
        })
        expect(findNull.docs.some((doc) => doc.id === createdNull.id)).toBe(true)
        expect(findNull.docs.some((doc) => doc.id === created.id)).toBe(false)

        const findNotNull = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: {
            location: { not_equals: null },
          },
        })
        expect(findNotNull.docs.some((doc) => doc.id === created.id)).toBe(true)
        expect(findNotNull.docs.some((doc) => doc.id === createdNull.id)).toBe(false)

        const findSorted = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          sort: 'location.lng',
        })
        expect(findSorted.docs.length).toBeGreaterThanOrEqual(2)
      })

      it('stores, retrieves and queries hasMany text and number fields', async () => {
        const created1 = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'Full Stack Snippet',
            code: 'console.log("full stack")',
            tags: ['typescript', 'node', 'cms'],
            scores: [10, 20, 30],
          },
        })

        const created2 = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'Frontend Snippet',
            code: 'console.log("frontend")',
            tags: ['react', 'css'],
            scores: [40, 50],
          },
        })

        const created3 = await adapter.create({
          collection: snippetsCollection,
          data: {
            title: 'Untagged Snippet',
            code: 'console.log("untagged")',
            tags: null,
            scores: null,
          },
        })

        const fetched = await adapter.findByID({
          collection: snippetsCollection,
          id: created1.id,
        })
        expect(fetched?.tags).toEqual(['typescript', 'node', 'cms'])
        expect(fetched?.scores).toEqual([10, 20, 30])

        // Query text contains
        const resContainsNode = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: { tags: { contains: 'node' } },
        })
        expect(resContainsNode.docs.some((d) => d.id === created1.id)).toBe(true)
        expect(resContainsNode.docs.some((d) => d.id === created2.id)).toBe(false)

        // Query text in
        const resInTags = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: { tags: { in: ['python', 'react'] } },
        })
        expect(resInTags.docs.some((d) => d.id === created2.id)).toBe(true)
        expect(resInTags.docs.some((d) => d.id === created1.id)).toBe(false)

        // Query number contains
        const resContainsScore = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: { scores: { contains: 20 } },
        })
        expect(resContainsScore.docs.some((d) => d.id === created1.id)).toBe(true)
        expect(resContainsScore.docs.some((d) => d.id === created2.id)).toBe(false)

        // Query number in
        const resInScores = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: { scores: { in: [99, 50] } },
        })
        expect(resInScores.docs.some((d) => d.id === created2.id)).toBe(true)
        expect(resInScores.docs.some((d) => d.id === created1.id)).toBe(false)

        // Query exact equality
        const resEquals = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: { tags: { equals: ['react', 'css'] } },
        })
        expect(resEquals.docs.some((d) => d.id === created2.id)).toBe(true)
        expect(resEquals.docs.some((d) => d.id === created1.id)).toBe(false)

        // Query null and not null
        const resNull = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: { tags: null },
        })
        expect(resNull.docs.some((d) => d.id === created3.id)).toBe(true)
        expect(resNull.docs.some((d) => d.id === created1.id)).toBe(false)

        const resNotNull = await adapter.find({
          collection: snippetsCollection,
          page: 1,
          limit: 10,
          where: { tags: { not_equals: null } },
        })
        expect(resNotNull.docs.some((d) => d.id === created1.id)).toBe(true)
        expect(resNotNull.docs.some((d) => d.id === created3.id)).toBe(false)
      })
    })

    describe('polymorphic relationships (ADR 0033)', () => {
      it('stores, updates, queries, sorts, localizes, and populates polymorphic single and hasMany relationships', async () => {
        const cat1 = await adapter.create({
          collection: categoriesCollection,
          data: { name: 'Poly Cat 1' },
        })
        const tag1 = await adapter.create({
          collection: tagsCollection,
          data: { slug: 'poly-tag-1' },
        })
        const tag2 = await adapter.create({
          collection: tagsCollection,
          data: { slug: 'poly-tag-2' },
        })

        const act1 = await adapter.create({
          collection: polymorphicActivitiesCollection,
          locale: 'en',
          data: {
            title: 'Activity One',
            _status: 'published',
            owner: { relationTo: 'categories', value: cat1.id },
            related: [
              { relationTo: 'tags', value: tag1.id },
              { relationTo: 'categories', value: cat1.id },
              { relationTo: 'tags', value: tag2.id },
            ],
            localizedOwner: { relationTo: 'categories', value: cat1.id },
            localizedRelated: [{ relationTo: 'tags', value: tag1.id }],
            meta: {
              reviewer: { relationTo: 'tags', value: tag2.id },
            },
            items: [{ label: 'First', target: { relationTo: 'categories', value: cat1.id } }],
            sections: [{ blockType: 'link', target: { relationTo: 'tags', value: tag1.id } }],
          },
        })

        expect(act1.owner).toEqual({ relationTo: 'categories', value: cat1.id })
        expect(act1.related).toEqual([
          { relationTo: 'tags', value: tag1.id },
          { relationTo: 'categories', value: cat1.id },
          { relationTo: 'tags', value: tag2.id },
        ])
        expect(act1.meta).toEqual({ reviewer: { relationTo: 'tags', value: tag2.id } })

        // Update Indonesian locale separately
        await adapter.update({
          collection: polymorphicActivitiesCollection,
          id: act1.id,
          locale: 'id',
          data: {
            localizedOwner: { relationTo: 'tags', value: tag2.id },
            localizedRelated: [{ relationTo: 'categories', value: cat1.id }],
          },
        })

        const act1IdLocale = await adapter.findByID({
          collection: polymorphicActivitiesCollection,
          id: act1.id,
          locale: 'id',
        })
        expect(act1IdLocale?.localizedOwner).toEqual({ relationTo: 'tags', value: tag2.id })
        expect(act1IdLocale?.localizedRelated).toEqual([
          { relationTo: 'categories', value: cat1.id },
        ])

        const act1AllLocales = await adapter.findByID({
          collection: polymorphicActivitiesCollection,
          id: act1.id,
          locale: 'all',
        })
        expect(act1AllLocales?.localizedOwner).toEqual({
          en: { relationTo: 'categories', value: cat1.id },
          id: { relationTo: 'tags', value: tag2.id },
        })
        expect(act1AllLocales?.localizedRelated).toEqual({
          en: [{ relationTo: 'tags', value: tag1.id }],
          id: [{ relationTo: 'categories', value: cat1.id }],
        })

        // Second activity with tag owner and null localizedOwner
        const act2 = await adapter.create({
          collection: polymorphicActivitiesCollection,
          locale: 'en',
          data: {
            title: 'Activity Two',
            _status: 'published',
            owner: { relationTo: 'tags', value: tag2.id },
            related: [{ relationTo: 'categories', value: cat1.id }],
          },
        })

        // Third activity with null owner
        const act3 = await adapter.create({
          collection: polymorphicActivitiesCollection,
          locale: 'en',
          data: {
            title: 'Activity Three',
            _status: 'published',
            owner: null,
          },
        })
        expect(act3.owner).toBeNull()

        // Where queries on single polymorphic subpaths & nullability
        const byRelTo = await adapter.find({
          collection: polymorphicActivitiesCollection,
          page: 1,
          limit: 10,
          where: { 'owner.relationTo': { equals: 'categories' } },
        })
        expect(byRelTo.docs.map((d) => d.id)).toEqual([act1.id])

        const byValue = await adapter.find({
          collection: polymorphicActivitiesCollection,
          page: 1,
          limit: 10,
          where: { 'owner.value': { equals: String(tag2.id) } },
        })
        expect(byValue.docs.map((d) => d.id)).toEqual([act2.id])

        const byNull = await adapter.find({
          collection: polymorphicActivitiesCollection,
          page: 1,
          limit: 10,
          where: { owner: null },
        })
        expect(byNull.docs.some((d) => d.id === act3.id)).toBe(true)
        expect(byNull.docs.some((d) => d.id === act1.id)).toBe(false)

        // Where queries on hasMany polymorphic subpaths & combined object filter
        const byRelatedCombo = await adapter.find({
          collection: polymorphicActivitiesCollection,
          page: 1,
          limit: 10,
          where: { related: { relationTo: 'tags', value: tag1.id } },
        })
        expect(byRelatedCombo.docs.map((d) => d.id)).toEqual([act1.id])

        // Where query inside group and array
        const byGroup = await adapter.find({
          collection: polymorphicActivitiesCollection,
          page: 1,
          limit: 10,
          where: { 'meta.reviewer.relationTo': { equals: 'tags' } },
        })
        expect(byGroup.docs.map((d) => d.id)).toEqual([act1.id])

        const byArray = await adapter.find({
          collection: polymorphicActivitiesCollection,
          page: 1,
          limit: 10,
          where: { 'items.target.relationTo': { equals: 'categories' } },
        })
        expect(byArray.docs.map((d) => d.id)).toEqual([act1.id])

        // Sort on polymorphic subpaths
        const sorted = await adapter.find({
          collection: polymorphicActivitiesCollection,
          page: 1,
          limit: 10,
          where: { owner: { not_equals: null } },
          sort: 'owner.relationTo',
        })
        expect(sorted.docs.map((d) => d.id)).toEqual([act1.id, act2.id])

        // Populate via Local API (depth: 1)
        const local = createLontarClient({
          ...config,
          collections: config.collections.map((c) => ({
            ...c,
            access: { read: () => true, create: () => true, update: () => true },
          })),
        })
        const populated = await local.findByID('polymorphic_activities', {
          id: act1.id,
          depth: 1,
          overrideAccess: true,
        })
        expect(populated?.owner).toMatchObject({
          relationTo: 'categories',
          value: { id: cat1.id, name: 'Poly Cat 1' },
        })
        expect(populated?.related).toHaveLength(3)
        expect(populated?.related).toMatchObject([
          {
            relationTo: 'tags',
            value: { id: tag1.id, slug: 'poly-tag-1' },
          },
          {
            relationTo: 'categories',
            value: { id: cat1.id, name: 'Poly Cat 1' },
          },
          {
            relationTo: 'tags',
            value: { id: tag2.id, slug: 'poly-tag-2' },
          },
        ])
      })

      it('loads join fields in batches across single, hasMany, and polymorphic targets with constraints, drafts, and depth cycles', async () => {
        const local = createLontarClient(config)
        const { author1, author2, author3, b1, b2, b3 } = await seedJoinFixtures(local)

        await assertJoinWriteRejection(local, Number(author1.id))
        await assertJoinDepthAndTargets(
          local,
          Number(author1.id),
          Number(b1.id),
          Number(b2.id),
          Number(b3.id),
        )
        await assertJoinConstraintAndBatching(config, adapter, local, [
          Number(author1.id),
          Number(author2.id),
          Number(author3.id),
        ])
      })
    })
  })
}

async function seedJoinFixtures(local: ReturnType<typeof createLontarClient>) {
  const author1 = await local.create('join_authors', {
    data: { name: 'Author One' },
    overrideAccess: true,
  })
  const author2 = await local.create('join_authors', {
    data: { name: 'Author Two' },
    overrideAccess: true,
  })
  const author3 = await local.create('join_authors', {
    data: { name: 'Author Three' },
    overrideAccess: true,
  })
  const cat = await local.create('categories', {
    data: { name: 'Publisher Cat' },
    overrideAccess: true,
  })

  const b1 = await local.create('join_books', {
    data: {
      title: 'Book 1',
      featured: true,
      author: author1.id,
      coAuthors: [author1.id, author2.id],
      publisher: { relationTo: 'join_authors', value: author1.id },
    },
    overrideAccess: true,
  })
  const b2 = await local.create('join_books', {
    data: {
      title: 'Book 2',
      featured: false,
      author: author1.id,
      coAuthors: [author2.id],
      publisher: { relationTo: 'categories', value: cat.id },
    },
    overrideAccess: true,
  })
  const b3 = await local.create('join_books', {
    data: { title: 'Book 3', featured: true, author: author1.id },
    overrideAccess: true,
  })
  await local.create('join_books', {
    data: { title: 'Draft Book', featured: true, author: author1.id },
    draft: true,
    overrideAccess: true,
  })
  return { author1, author2, author3, b1, b2, b3 }
}

async function assertJoinWriteRejection(
  local: ReturnType<typeof createLontarClient>,
  authorId: number,
) {
  await expect(
    local.create('join_authors', {
      data: { name: 'Bad', books: [] } as never,
      overrideAccess: true,
    }),
  ).rejects.toThrow(/Validation failed/)
  await expect(
    local.update('join_authors', {
      id: authorId,
      data: { books: null },
      overrideAccess: true,
    }),
  ).rejects.toThrow(/Validation failed/)
}

async function assertJoinDepthZeroAndDrafts(
  local: ReturnType<typeof createLontarClient>,
  authorId: number,
) {
  const a1Depth0 = await local.findByID('join_authors', {
    id: authorId,
    depth: 0,
    overrideAccess: true,
  })
  expect(a1Depth0).not.toBeNull()
  expect(a1Depth0!.books).toEqual({ docs: [], totalDocs: 3 })
  expect(a1Depth0!.featuredBooks).toEqual({ docs: [], totalDocs: 2 })
  expect(a1Depth0!.coAuthoredBooks).toEqual({ docs: [], totalDocs: 1 })
  expect(a1Depth0!.publishedBooks).toEqual({ docs: [], totalDocs: 1 })

  const a1Draft = await local.findByID('join_authors', {
    id: authorId,
    depth: 0,
    draft: true,
    overrideAccess: true,
  })
  expect(a1Draft).not.toBeNull()
  expect(a1Draft!.books).toEqual({ docs: [], totalDocs: 4 })
}

async function assertJoinDepthAndTargets(
  local: ReturnType<typeof createLontarClient>,
  authorId: number,
  b1Id: number,
  b2Id: number,
  b3Id: number,
) {
  await assertJoinDepthZeroAndDrafts(local, authorId)

  const a1Depth2 = await local.findByID('join_authors', {
    id: authorId,
    depth: 2,
    overrideAccess: true,
  })
  expect(a1Depth2).not.toBeNull()
  const doc = a1Depth2!
  const a1Books = doc.books as { docs: Array<Record<string, unknown>>; totalDocs: number }
  expect(a1Books.totalDocs).toBe(3)
  expect(a1Books.docs.map((d) => d.id)).toEqual([b3Id, b2Id])
  expect(a1Books.docs[0]?.author).toBe(authorId)

  const a1Featured = doc.featuredBooks as {
    docs: Array<Record<string, unknown>>
    totalDocs: number
  }
  expect(a1Featured.totalDocs).toBe(2)
  expect(a1Featured.docs.map((d) => d.id)).toEqual([b1Id, b3Id].sort((x, y) => x - y))

  const a1Poly = doc.publishedBooks as {
    docs: Array<Record<string, unknown>>
    totalDocs: number
  }
  expect(a1Poly.totalDocs).toBe(1)
  expect(a1Poly.docs[0]?.id).toBe(b1Id)
}

async function assertJoinConstraintAndBatching(
  config: Config,
  adapter: DatabaseAdapter,
  local: ReturnType<typeof createLontarClient>,
  authorIds: number[],
) {
  const constrainedLocal = createLontarClient({
    ...config,
    collections: config.collections.map((c) =>
      c.slug === joinBooksCollection.slug
        ? { ...c, access: { ...c.access, read: () => ({ featured: { equals: true } }) } }
        : c,
    ),
  })
  const constrainedAuthor = await constrainedLocal.findByID('join_authors', {
    id: authorIds[0]!,
    depth: 1,
  })
  const constrainedBooks = constrainedAuthor?.books as {
    docs: Array<Record<string, unknown>>
    totalDocs: number
  }
  expect(constrainedBooks.totalDocs).toBe(2)
  expect(constrainedBooks.docs.every((d) => d.featured === true)).toBe(true)

  const findSpy = vi.spyOn(adapter, 'find')
  const findJoinedSpy = vi.spyOn(adapter, 'findJoined')
  await local.find('join_authors', {
    where: { id: { equals: authorIds[0]! } },
    depth: 1,
    overrideAccess: true,
  })
  const singleFindCalls = findSpy.mock.calls.length
  const singleJoinCalls = findJoinedSpy.mock.calls.length

  findSpy.mockClear()
  findJoinedSpy.mockClear()

  await local.find('join_authors', {
    where: { id: { in: authorIds } },
    depth: 1,
    overrideAccess: true,
  })
  expect(findSpy).toHaveBeenCalledTimes(singleFindCalls)
  expect(findJoinedSpy).toHaveBeenCalledTimes(singleJoinCalls)
  const expectedJoins = Object.values(joinAuthorsCollection.fields).filter(
    (f) => f.type === 'join',
  ).length
  expect(singleJoinCalls).toBe(expectedJoins)

  findSpy.mockRestore()
  findJoinedSpy.mockRestore()
}
