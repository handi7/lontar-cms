import { describe, expect, it } from 'vitest'
import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import { global } from '../config/global'
import type { DatabaseAdapter, DocumentData, StoredDoc } from '../database/adapter'
import { block, fields as f } from '../fields'
import { AccessDeniedError, NotFoundError, ValidationError } from '../operations'
import type { SortItem } from '../query/types'
import { getLontar } from './index'

function applyFilter(doc: StoredDoc, key: string, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return true
  const fRecord = filter as Record<string, unknown>
  if ('equals' in fRecord && doc[key] !== fRecord.equals) {
    return false
  }
  if ('in' in fRecord && Array.isArray(fRecord.in) && !fRecord.in.includes(doc[key])) {
    return false
  }
  return true
}

function filterDocs(docs: StoredDoc[], where: unknown): StoredDoc[] {
  if (!where || typeof where !== 'object') return docs
  let result = docs
  for (const [key, filter] of Object.entries(where as Record<string, unknown>)) {
    result = result.filter((d) => applyFilter(d, key, filter))
  }
  return result
}

function sortDocs(docs: StoredDoc[], sort?: string | SortItem[]): StoredDoc[] {
  if (sort === '-id') {
    return [...docs].sort((a, b) => Number(b.id) - Number(a.id))
  }
  return docs
}

function createMockDb(
  initialDocs: Record<string, Array<DocumentData & { id?: number }>> = {},
  initialGlobals: Record<string, DocumentData> = {},
): DatabaseAdapter {
  const store = new Map<string, StoredDoc[]>()
  for (const [slug, docs] of Object.entries(initialDocs)) {
    store.set(
      slug,
      docs.map((d, i) => ({
        id: d.id ?? i + 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...d,
      })),
    )
  }

  const globalStore = new Map<string, StoredDoc>()
  for (const [slug, g] of Object.entries(initialGlobals)) {
    globalStore.set(slug, {
      id: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      ...g,
    })
  }
  let nextId = 100

  return {
    name: 'mock',
    find: ({ collection: col, where, sort, page = 1, limit = 10 }) => {
      const all = store.get(col.slug) ?? []
      const filtered = filterDocs(all, where)
      const sorted = sortDocs(filtered, sort)
      const start = (page - 1) * limit
      const paginated = sorted.slice(start, start + limit)
      return Promise.resolve({
        docs: paginated,
        totalDocs: sorted.length,
        limit,
        totalPages: Math.ceil(sorted.length / limit) || 1,
        page,
        hasPrevPage: page > 1,
        hasNextPage: start + limit < sorted.length,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: start + limit < sorted.length ? page + 1 : null,
      })
    },
    findByID: ({ collection: col, id }) => {
      const docs = store.get(col.slug) ?? []
      const found = docs.find((d) => d.id === id)
      return Promise.resolve(found ?? null)
    },
    create: ({ collection: col, data }) => {
      const docs = store.get(col.slug) ?? []
      const id = ++nextId
      const created: StoredDoc = {
        id,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...data,
      }
      docs.push(created)
      store.set(col.slug, docs)
      return Promise.resolve(created)
    },
    update: ({ collection: col, id, data }) => {
      const docs = store.get(col.slug) ?? []
      const idx = docs.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const updated: StoredDoc = {
        ...docs[idx]!,
        ...data,
        updatedAt: '2026-11-02T00:00:00.000Z',
      }
      docs[idx] = updated
      return Promise.resolve(updated)
    },
    delete: ({ collection: col, id }) => {
      const docs = store.get(col.slug) ?? []
      const idx = docs.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const [removed] = docs.splice(idx, 1)
      return Promise.resolve(removed ?? null)
    },
    findGlobal: ({ global: g }) => {
      return Promise.resolve(globalStore.get(g.slug) ?? null)
    },
    updateGlobal: ({ global: g, data }) => {
      const prev = globalStore.get(g.slug) ?? {
        id: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      }
      const updated: StoredDoc = {
        ...prev,
        ...data,
        updatedAt: '2026-11-02T00:00:00.000Z',
      }
      globalStore.set(g.slug, updated)
      return Promise.resolve(updated)
    },
    toSchemaFile: () => '',
    migrate: () => Promise.resolve(),
  }
}

describe('Local API (getLontar)', () => {
  const authorsCol = collection({
    slug: 'authors',
    fields: {
      name: f.text({ required: true }),
    },
  })

  const postsCol = collection({
    slug: 'posts',
    access: {
      read: ({ user }) => Boolean(user),
      create: ({ user }) => Boolean(user),
      update: ({ user }) => Boolean(user),
      delete: ({ user }) => user?.role === 'admin',
    },
    fields: {
      title: f.text({ required: true }),
      slug: f.slug({ from: 'title' }),
      views: f.number(),
      author: f.relationship({ relationTo: 'authors' }),
    },
    hooks: {
      beforeChange: [
        ({ data, operation }) => {
          if (operation === 'create' && data.title === 'AutoHook') {
            data.views = 999
          }
          return data
        },
      ],
      afterRead: [
        ({ doc }) => {
          if (typeof doc.title === 'string') {
            return { ...doc, formattedTitle: `Post: ${doc.title}` }
          }
          return doc
        },
      ],
    },
  })

  const settingsGlobal = global({
    slug: 'settings',
    access: {
      read: ({ user }) => Boolean(user),
      update: ({ user }) => user?.role === 'admin',
    },
    fields: {
      siteName: f.text({ required: true }),
      footer: f.textarea(),
    },
  })

  const pagesCol = collection({
    slug: 'pages',
    fields: {
      title: f.text({ required: true }),
      gallery: f.array({
        fields: {
          caption: f.text(),
          tags: f.array({
            fields: {
              name: f.text(),
            },
          }),
        },
      }),
      layout: f.blocks({
        blocks: [
          block({
            slug: 'galleryBlock',
            fields: {
              images: f.array({
                fields: {
                  caption: f.text(),
                },
              }),
            },
          }),
        ],
      }),
    },
  })

  function createTestConfig(initialDocs = {}, initialGlobals = {}) {
    const db = createMockDb(initialDocs, initialGlobals)
    return {
      config: defineConfig({
        secret: 'test-secret',
        db,
        collections: [authorsCol, postsCol, pagesCol],
        globals: [settingsGlobal],
      }),
      db,
    }
  }

  it('lontar.find queries documents with overrideAccess: true by default', async () => {
    const { config } = createTestConfig({
      authors: [{ id: 1, name: 'Alice' }],
      posts: [
        { id: 1, title: 'First Post', views: 10, author: 1 },
        { id: 2, title: 'Second Post', views: 20, author: 1 },
      ],
    })

    const lontar = await getLontar(config)
    const result = await lontar.find('posts', {
      depth: 1,
      sort: '-id',
    })

    expect(result.totalDocs).toBe(2)
    expect(result.docs[0]?.title).toBe('Second Post')
    expect(result.docs[0]?.formattedTitle).toBe('Post: Second Post')
    // Populated relationship
    expect(result.docs[0]?.author).toEqual(expect.objectContaining({ id: 1, name: 'Alice' }))
  })

  it('lontar.find enforces access control when overrideAccess: false', async () => {
    const { config } = createTestConfig({
      posts: [{ id: 1, title: 'Post 1' }],
    })
    const lontar = await getLontar(config)

    // Unauthenticated caller with overrideAccess: false throws AccessDeniedError
    await expect(lontar.find('posts', { overrideAccess: false })).rejects.toThrow(AccessDeniedError)

    // Authenticated user succeeds
    const user = {
      id: 'u1',
      name: 'User',
      email: 'u@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const result = await lontar.find('posts', {
      overrideAccess: false,
      user,
    })
    expect(result.totalDocs).toBe(1)
  })

  it('lontar.findByID finds doc by number ID or options object', async () => {
    const { config } = createTestConfig({
      authors: [{ id: 10, name: 'Bob' }],
      posts: [{ id: 42, title: 'Answer', author: 10 }],
    })
    const lontar = await getLontar(config)

    const doc1 = await lontar.findByID('posts', 42, { depth: 1 })
    expect(doc1?.id).toBe(42)
    expect(doc1?.author).toEqual(expect.objectContaining({ id: 10, name: 'Bob' }))

    const doc2 = await lontar.findByID('posts', { id: 42 })
    expect(doc2?.id).toBe(42)

    const missing = await lontar.findByID('posts', 999)
    expect(missing).toBeNull()
  })

  it('lontar.create creates document with validation and hooks', async () => {
    const { config } = createTestConfig()
    const lontar = await getLontar(config)

    // Successful create with beforeChange hook firing
    const created = await lontar.create('posts', {
      title: 'AutoHook',
      slug: 'autohook',
    })
    expect(created.id).toBeDefined()
    expect(created.views).toBe(999)

    // Validation failure (missing required title)
    await expect(lontar.create('posts', { views: 5 })).rejects.toThrow(ValidationError)
  })

  it('lontar.update updates document and validates fields', async () => {
    const { config } = createTestConfig({
      posts: [{ id: 5, title: 'Original Title', views: 0 }],
    })
    const lontar = await getLontar(config)

    const updated = await lontar.update('posts', 5, {
      title: 'Updated Title',
    })
    expect(updated.title).toBe('Updated Title')

    // Updating non-existent doc throws NotFoundError
    await expect(lontar.update('posts', 999, { title: 'Ghost' })).rejects.toThrow(NotFoundError)
  })

  it('lontar.delete deletes document and returns deleted record', async () => {
    const { config } = createTestConfig({
      posts: [{ id: 1, title: 'To Delete' }],
    })
    const lontar = await getLontar(config)

    const deleted = await lontar.delete('posts', 1)
    expect(deleted?.id).toBe(1)

    const check = await lontar.findByID('posts', 1)
    expect(check).toBeNull()

    const missing = await lontar.delete('posts', 999)
    expect(missing).toBeNull()
  })

  it('lontar.findGlobal and lontar.updateGlobal manage single documents', async () => {
    const { config } = createTestConfig({}, { settings: { siteName: 'Initial Site' } })
    const lontar = await getLontar(config)

    const initial = await lontar.findGlobal('settings')
    expect(initial.siteName).toBe('Initial Site')

    const updated = await lontar.updateGlobal('settings', {
      footer: 'Copyright 2026',
    })
    expect(updated.siteName).toBe('Initial Site')
    expect(updated.footer).toBe('Copyright 2026')
  })

  it('throws NotFoundError for unknown collection or global', async () => {
    const { config } = createTestConfig()
    const lontar = await getLontar(config)

    await expect(lontar.find('non-existent')).rejects.toThrow(NotFoundError)
    await expect(lontar.findGlobal('non-existent')).rejects.toThrow(NotFoundError)
  })

  it('throws ValidationError for invalid IDs', async () => {
    const { config } = createTestConfig()
    const lontar = await getLontar(config)

    await expect(lontar.findByID('posts', -1)).rejects.toThrow(ValidationError)
    await expect(lontar.findByID('posts', 'abc')).rejects.toThrow(ValidationError)
  })

  it('lontar.create and lontar.update recursively generate row ids for nested array and block items (#176)', async () => {
    const { config } = createTestConfig()
    const lontar = await getLontar(config)

    const created = await lontar.create('pages', {
      title: 'Home Page',
      gallery: [
        {
          caption: 'Hero Image',
          tags: [{ name: 'featured' }, { name: 'landscape' }],
        },
      ],
      layout: [
        {
          blockType: 'galleryBlock',
          images: [{ caption: 'Photo 1' }, { caption: 'Photo 2' }],
        },
      ],
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

    const firstBlock = (created.layout as LayoutItem[])[0]!
    const img1 = firstBlock.images[0]!
    const img2 = firstBlock.images[1]!
    expect(firstBlock.id).toMatch(/^[0-9a-f]{16}$/)
    expect(firstBlock.images).toHaveLength(2)
    expect(img1.id).toMatch(/^[0-9a-f]{16}$/)
    expect(img2.id).toMatch(/^[0-9a-f]{16}$/)
    expect(img1.id).not.toBe(img2.id)

    const firstGallery = (created.gallery as GalleryItem[])[0]!
    const tag1 = firstGallery.tags[0]!
    const tag2 = firstGallery.tags[1]!
    expect(firstGallery.id).toMatch(/^[0-9a-f]{16}$/)
    expect(firstGallery.tags).toHaveLength(2)
    expect(tag1.id).toMatch(/^[0-9a-f]{16}$/)
    expect(tag2.id).toMatch(/^[0-9a-f]{16}$/)
    expect(tag1.id).not.toBe(tag2.id)

    // Update: preserve first image id, append new image without id
    const existingImage0Id = img1.id
    const updated = await lontar.update('pages', Number(created.id), {
      layout: [
        {
          id: firstBlock.id,
          blockType: 'galleryBlock',
          images: [
            { id: existingImage0Id, caption: 'Photo 1 Updated' },
            { caption: 'Photo 3 New' },
          ],
        },
      ],
    })

    const updatedLayout = (updated.layout ?? []) as LayoutItem[]
    const updatedFirstBlock = updatedLayout[0]!
    const updImg1 = updatedFirstBlock.images[0]!
    const updImg2 = updatedFirstBlock.images[1]!
    expect(updatedFirstBlock.id).toBe(firstBlock.id)
    expect(updImg1.id).toBe(existingImage0Id)
    expect(updImg2.id).toMatch(/^[0-9a-f]{16}$/)
    expect(updImg2.id).not.toBe(existingImage0Id)
  })
})
