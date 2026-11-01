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
import { createLontar } from '../create-lontar'

function createDepthMockAdapter(store: Record<string, StoredDoc[]>): DatabaseAdapter {
  return {
    name: 'mock',
    find({ collection, where }): Promise<PaginatedDocs> {
      let items = (store[collection.slug] ?? []).map((d) => ({ ...d }))
      if (where?.id && typeof where.id === 'object' && 'in' in where.id) {
        const inIds = Array.isArray(where.id.in) ? where.id.in : []
        items = items.filter((item) => inIds.includes(item.id))
      }
      return Promise.resolve({
        docs: items,
        totalDocs: items.length,
        limit: 10,
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
    fields: {
      name: f.text({ required: true }),
    },
  })

  const categories = collection({
    slug: 'categories',
    fields: {
      name: f.text({ required: true }),
    },
  })

  const posts = collection({
    slug: 'posts',
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
})
