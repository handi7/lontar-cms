import { describe, expect, it } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type {
  DatabaseAdapter,
  DocumentData,
  PaginatedDocs,
  StoredDoc,
} from '../../database/adapter'
import { fields as f } from '../../fields'
import type { Where } from '../../query/types'
import { createLontar } from '../create-lontar'

function extractStoreInIds(where?: Where): unknown[] | null {
  if (!where?.id || typeof where.id !== 'object' || !('in' in where.id)) return null
  const inCond = where.id as { in?: unknown }
  return Array.isArray(inCond.in) ? inCond.in : null
}

function filterStoreItems(items: StoredDoc[], where?: Where): StoredDoc[] {
  const inIds = extractStoreInIds(where)
  if (!inIds) return items
  return items.filter((item) => inIds.includes(item.id))
}

function resolveStoreLimit(
  limit: number,
  maxLimit: number | undefined,
  overrideLimit: boolean | undefined,
): number {
  if (overrideLimit || maxLimit === undefined) return limit
  return Math.min(limit, maxLimit)
}

function createDepthMockAdapter(store: Record<string, StoredDoc[]>): DatabaseAdapter {
  return {
    name: 'mock',
    find({ collection, where, limit, overrideLimit }): Promise<PaginatedDocs> {
      const all = (store[collection.slug] ?? []).map((d) => ({ ...d }))
      const filtered = filterStoreItems(all, where)
      const effectiveLimit = resolveStoreLimit(
        limit,
        collection.pagination?.maxLimit,
        overrideLimit,
      )
      const docs = effectiveLimit >= 0 ? filtered.slice(0, effectiveLimit) : filtered
      return Promise.resolve({
        docs,
        totalDocs: docs.length,
        limit: effectiveLimit,
        page: 1,
        totalPages: 1,
      })
    },
    findByID({ collection, id }): Promise<StoredDoc | null> {
      const items = store[collection.slug] ?? []
      const found = items.find((d) => d.id === id)
      return Promise.resolve(found ? { ...found } : null)
    },
    create({ collection, data }): Promise<StoredDoc> {
      const items = store[collection.slug] ?? []
      const id = items.length + 1
      const created: StoredDoc = {
        id,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...data,
      }
      items.push(created)
      return Promise.resolve({ ...created })
    },
    update({ collection, id, data }): Promise<StoredDoc | null> {
      const items = store[collection.slug] ?? []
      const idx = items.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const existing = items[idx]!
      const updated: StoredDoc = {
        ...existing,
        ...data,
        updatedAt: '2026-01-02T00:00:00.000Z',
      }
      items[idx] = updated
      return Promise.resolve({ ...updated })
    },
    delete({ collection, id }): Promise<StoredDoc | null> {
      const items = store[collection.slug] ?? []
      const idx = items.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const [removed] = items.splice(idx, 1)
      return Promise.resolve(removed ?? null)
    },
    findGlobal(): Promise<StoredDoc | null> {
      return Promise.resolve(null)
    },
    updateGlobal(): Promise<StoredDoc> {
      return Promise.reject(new Error('Not implemented'))
    },
    toSchemaFile(): string {
      return ''
    },
    migrate(): Promise<void> {
      return Promise.resolve()
    },
  }
}

describe('REST API depth query param', () => {
  const users = collection({
    slug: 'users',
    access: { read: () => true },
    fields: {
      name: f.text({ required: true }),
    },
  })

  const categories = collection({
    slug: 'categories',
    access: { read: () => true },
    fields: {
      name: f.text({ required: true }),
    },
  })

  const posts = collection({
    slug: 'posts',
    access: {
      read: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    },
    fields: {
      title: f.text({ required: true }),
      author: f.relationship({ relationTo: 'users' }),
      categories: f.relationship({ relationTo: 'categories', hasMany: true }),
    },
  })

  function setupApp() {
    const store: Record<string, StoredDoc[]> = {
      users: [
        {
          id: 1,
          name: 'Alice',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          name: 'Bob',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      categories: [
        {
          id: 10,
          name: 'Tech',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 20,
          name: 'Design',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      posts: [
        {
          id: 101,
          title: 'Hello World',
          author: 1,
          categories: [20, 10],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }

    const adapter = createDepthMockAdapter(store)
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [posts, users, categories],
    })

    return createLontar(config)
  }

  it('GET /api/:collection returns IDs only by default (depth=0)', async () => {
    const app = setupApp()
    const res = await app.request('/api/posts')
    expect(res.status).toBe(200)

    const body = (await res.json()) as { docs: DocumentData[] }
    expect(body.docs).toHaveLength(1)
    expect(body.docs[0]?.author).toBe(1)
    expect(body.docs[0]?.categories).toEqual([20, 10])
  })

  it('GET /api/:collection?depth=1 populates single and hasMany relationships', async () => {
    const app = setupApp()
    const res = await app.request('/api/posts?depth=1')
    expect(res.status).toBe(200)

    const body = (await res.json()) as { docs: DocumentData[] }
    expect(body.docs).toHaveLength(1)
    expect(body.docs[0]?.author).toEqual({
      id: 1,
      name: 'Alice',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(body.docs[0]?.categories).toEqual([
      {
        id: 20,
        name: 'Design',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 10,
        name: 'Tech',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('GET /api/:collection/:id returns IDs only by default', async () => {
    const app = setupApp()
    const res = await app.request('/api/posts/101')
    expect(res.status).toBe(200)

    const body = (await res.json()) as DocumentData
    expect(body.id).toBe(101)
    expect(body.author).toBe(1)
    expect(body.categories).toEqual([20, 10])
  })

  it('GET /api/:collection/:id?depth=1 populates related documents', async () => {
    const app = setupApp()
    const res = await app.request('/api/posts/101?depth=1')
    expect(res.status).toBe(200)

    const body = (await res.json()) as DocumentData
    expect(body.id).toBe(101)
    expect(body.author).toEqual({
      id: 1,
      name: 'Alice',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(body.categories).toEqual([
      {
        id: 20,
        name: 'Design',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 10,
        name: 'Tech',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('POST /api/:collection?depth=1 returns created document with populated relations', async () => {
    const app = setupApp()
    const res = await app.request('/api/posts?depth=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Post',
        author: 2,
        categories: [10],
      }),
    })
    expect(res.status).toBe(201)

    const body = (await res.json()) as DocumentData
    expect(body.title).toBe('New Post')
    expect(body.author).toEqual({
      id: 2,
      name: 'Bob',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(body.categories).toEqual([
      {
        id: 10,
        name: 'Tech',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('PATCH /api/:collection/:id?depth=1 returns updated document with populated relations', async () => {
    const app = setupApp()
    const res = await app.request('/api/posts/101?depth=1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: 2,
      }),
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as DocumentData
    expect(body.id).toBe(101)
    expect(body.author).toEqual({
      id: 2,
      name: 'Bob',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(body.categories).toEqual([
      {
        id: 20,
        name: 'Design',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 10,
        name: 'Tech',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('GET /api/:collection/:id?depth=1 resolves all references despite target collection maxLimit', async () => {
    const cappedCategoriesCol = collection({
      slug: 'capped-categories',
      fields: {
        name: f.text({ required: true }),
      },
      pagination: { maxLimit: 1 },
      access: { read: () => true },
    })

    const postsWithCappedCategories = collection({
      slug: 'capped-posts',
      fields: {
        title: f.text({ required: true }),
        categories: f.relationship({
          relationTo: 'capped-categories',
          hasMany: true,
        }),
      },
      access: { read: () => true },
    })

    const initialStore: Record<string, StoredDoc[]> = {
      'capped-categories': [
        { id: 1, name: 'Cat 1', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 2, name: 'Cat 2', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 3, name: 'Cat 3', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      'capped-posts': [
        {
          id: 1,
          title: 'Post with 3 categories',
          categories: [1, 2, 3],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    }

    const app = createLontar(
      defineConfig({
        secret: 'test-secret-at-least-32-characters-long',
        db: createDepthMockAdapter(initialStore),
        collections: [cappedCategoriesCol, postsWithCappedCategories],
      }),
    )

    const res = await app.request('/api/capped-posts/1?depth=1')
    expect(res.status).toBe(200)

    const body = (await res.json()) as DocumentData
    expect(body.categories).toEqual([
      expect.objectContaining({ id: 1, name: 'Cat 1' }),
      expect.objectContaining({ id: 2, name: 'Cat 2' }),
      expect.objectContaining({ id: 3, name: 'Cat 3' }),
    ])
  })
})
