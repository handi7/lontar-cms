import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import type { CollectionConfig, Config, GlobalConfig } from '@lontar/core'
import { mysqlAdapter, type MysqlAdapter } from './adapter'

const DATABASE_URL = process.env.DATABASE_URL || 'mysql://lontar:lontar@127.0.0.1:3306/lontar'

const postsCollection: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  fields: {
    title: { type: 'text', required: true, maxLength: 120 },
    views: { type: 'number', integer: true, defaultValue: 0 },
    content: { type: 'richText' },
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
  let adapter: MysqlAdapter
  let tempDir: string
  let migrationsDir: string

  beforeAll(async () => {
    // Drop existing tables if any
    const pool = mysql.createPool(DATABASE_URL)
    await pool.query('DROP TABLE IF EXISTS session')
    await pool.query('DROP TABLE IF EXISTS account')
    await pool.query('DROP TABLE IF EXISTS verification')
    await pool.query('DROP TABLE IF EXISTS user')
    await pool.query('DROP TABLE IF EXISTS posts')
    await pool.query('DROP TABLE IF EXISTS header')
    await pool.query('DROP TABLE IF EXISTS __drizzle_migrations')
    await pool.end()

    adapter = mysqlAdapter({ url: DATABASE_URL })

    const config: Config = {
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection],
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
      const pool = mysql.createPool(DATABASE_URL)
      await pool.query('DROP TABLE IF EXISTS session')
      await pool.query('DROP TABLE IF EXISTS account')
      await pool.query('DROP TABLE IF EXISTS verification')
      await pool.query('DROP TABLE IF EXISTS user')
      await pool.query('DROP TABLE IF EXISTS posts')
      await pool.query('DROP TABLE IF EXISTS header')
      await pool.query('DROP TABLE IF EXISTS __drizzle_migrations')
      await pool.end()
    } finally {
      await adapter.close()
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
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
})
