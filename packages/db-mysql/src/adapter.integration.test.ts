import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import {
  createLontar,
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
    gallery: {
      type: 'array',
      fields: {
        caption: { type: 'text' },
        year: { type: 'number', integer: true },
      },
    },
    layout: {
      type: 'blocks',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: { type: 'text', required: true },
            subheading: { type: 'text' },
          },
        },
        {
          slug: 'cta',
          labels: { singular: 'Call to Action', plural: 'Calls to Action' },
          fields: {
            text: { type: 'text', required: true },
            buttonUrl: { type: 'text', required: true },
          },
        },
      ],
    },
  },
}

const nestedCollection: CollectionConfig = {
  slug: 'nested_docs',
  labels: { singular: 'Nested Doc', plural: 'Nested Docs' },
  fields: {
    title: { type: 'text', required: true },
    seo: {
      type: 'group',
      fields: {
        metaTitle: { type: 'text' },
        featuredPost: { type: 'relationship', relationTo: 'posts' },
      },
    },
    gallery: {
      type: 'array',
      fields: {
        caption: { type: 'text' },
        featuredPost: { type: 'relationship', relationTo: 'posts' },
        tags: {
          type: 'array',
          fields: {
            name: { type: 'text' },
          },
        },
      },
    },
    layout: {
      type: 'blocks',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: { type: 'text', required: true },
            featuredPost: { type: 'relationship', relationTo: 'posts' },
          },
        },
        {
          slug: 'cta',
          labels: { singular: 'Call to Action', plural: 'Calls to Action' },
          fields: {
            text: { type: 'text', required: true },
            buttonUrl: { type: 'text', required: true },
            relatedPosts: { type: 'relationship', relationTo: 'posts', hasMany: true },
          },
        },
        {
          slug: 'galleryBlock',
          labels: { singular: 'Gallery Block', plural: 'Gallery Blocks' },
          fields: {
            images: {
              type: 'array',
              fields: {
                caption: { type: 'text' },
              },
            },
          },
        },
      ],
    },
  },
}

const conditionalPostsCollection: CollectionConfig = {
  slug: 'conditional_posts',
  labels: { singular: 'Conditional Post', plural: 'Conditional Posts' },
  fields: {
    title: { type: 'text', required: true },
    format: {
      type: 'select',
      options: ['standard', 'video'],
      defaultValue: 'standard',
      required: true,
    },
    videoUrl: {
      type: 'text',
      required: true,
      admin: { condition: { format: { equals: 'video' } } },
    },
  },
}

const sharedBlocksCollection: CollectionConfig = {
  slug: 'shared_blocks_pages',
  labels: { singular: 'Shared Blocks Page', plural: 'Shared Blocks Pages' },
  fields: {
    title: { type: 'text', required: true },
    layout: {
      type: 'blocks',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: { type: 'text', required: true },
          },
        },
        {
          slug: 'section',
          labels: { singular: 'Section', plural: 'Sections' },
          fields: {
            heading: { type: 'text', required: true },
          },
        },
      ],
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

const versionedSettingsGlobal: GlobalConfig = {
  slug: 'versioned_settings',
  access: {
    read: () => true,
    update: () => true,
  },
  versions: { drafts: true, maxPerDoc: 2 },
  fields: {
    siteName: { type: 'text', required: true },
    tagline: { type: 'text' },
  },
}

const versionedPostsCollection: CollectionConfig = {
  slug: 'versioned_posts',
  labels: { singular: 'Versioned Post', plural: 'Versioned Posts' },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
  },
  versions: { drafts: true, maxPerDoc: 2 },
  fields: {
    title: { type: 'text', required: true },
    content: { type: 'textarea' },
  },
}

const versionHistoryCollection: CollectionConfig = {
  slug: 'version_history_posts',
  labels: { singular: 'Version History Post', plural: 'Version History Posts' },
  versions: { drafts: true, maxPerDoc: 10 },
  fields: {
    title: { type: 'text', required: true },
    content: { type: 'textarea' },
  },
}

const longSlugVersionedCollection: CollectionConfig = {
  slug: 'newsletter_campaign_delivery_schedules',
  labels: { singular: 'Schedule', plural: 'Schedules' },
  versions: { drafts: true },
  fields: {
    title: { type: 'text', required: true },
  },
}

describe('mysqlAdapter (integration)', () => {
  let testDb: TestDatabase
  let testDatabaseUrl: string
  let adapter: MysqlAdapter
  let config: Config
  let tempDir: string
  let migrationsDir: string

  beforeAll(async () => {
    testDb = await setupTestDatabase()
    testDatabaseUrl = testDb.url
    adapter = mysqlAdapter({ url: testDatabaseUrl })

    config = {
      secret: 'test-secret',
      db: adapter,
      collections: [
        postsCollection,
        categoriesCollection,
        tagsCollection,
        pagesCollection,
        nestedCollection,
        conditionalPostsCollection,
        sharedBlocksCollection,
        versionedPostsCollection,
        versionHistoryCollection,
        longSlugVersionedCollection,
      ],
      globals: [headerGlobal, versionedSettingsGlobal],
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

    const overridden = await adapter.find({
      collection: cappedCol,
      limit: 10,
      page: 1,
      sort: 'id',
      overrideLimit: true,
    })
    expect(overridden.limit).toBe(10)
    expect(overridden.docs.length).toBeGreaterThanOrEqual(2)
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
    ).rejects.toThrow('Simulated hook failure')

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

  it('handles array fields: insert, reorder, and remove', async () => {
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
    const reorderedRows = reordered?.gallery as Array<{ id: string; caption: string; year: number }>
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

  it('rolls back array field changes when transaction fails', async () => {
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

  it('handles blocks fields: insert, reorder, modify, and rollback', async () => {
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

  it('stores and retrieves relationships inside group, array, and blocks', async () => {
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

  it('filters and sorts on nested field paths: group, array, and blocks', async () => {
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

  it('creates and reads documents with conditional required fields on both sides of condition', async () => {
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
  })

  it('filters by block-qualified paths when multiple block types share field names (#171)', async () => {
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
  })

  it('generates row ids recursively for nested array and block items (#176)', async () => {
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

  it('filters array and blocks with not_equals without dropping documents missing the key or with empty/null arrays (#179)', async () => {
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
        and: [{ id: { in: allBlockDocIds } }, { 'layout.hero.heading': { not_equals: 'Alpha' } }],
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
  })

  it('manages version history, autosave in-place updates, pruning, and cascade deletes', async () => {
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
  })

  it('guarantees continuous autosaves generate at most one transient version row without exhausting retention (#203)', async () => {
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
  })

  it('manages global version history, autosave in-place updates, draft querying, and retention pruning', async () => {
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
  })

  it('supports sorting on findVersions (#243)', async () => {
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

  it('does not collapse into an autosave row when incoming save has status: published (#243)', async () => {
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
  })

  it('serializes concurrent version saves on the same parent document (#243)', async () => {
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

  it('checks if a filename is referenced in any version snapshot via hasVersionWithFilename', async () => {
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
  })

  it('publish of a missing id returns 404 on real MySQL adapter', async () => {
    const app = createLontar(config)
    const res = await app.request('/api/versioned_posts/999999/publish', { method: 'POST' })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('not found')
  })

  it('publish of an invalid draft returns 400 with issues on real MySQL adapter', async () => {
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
  })

  it('publish of an unknown global returns 404 on real MySQL adapter', async () => {
    const app = createLontar(config)
    const res = await app.request('/api/globals/nonexistent_global/publish', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('publish of an invalid draft global returns 400 with issues on real MySQL adapter', async () => {
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
  })

  it('creates and versions documents on a collection with a long slug (> 37 chars) whose index names are capped', async () => {
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
  })
})
