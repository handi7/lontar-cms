import { describe, expect, it, vi } from 'vitest'
import { Posts } from '../__fixtures__/posts'
import type { Config, DatabaseAdapter, StoredDoc } from '../index'
import { createLontar } from './create-lontar'

const mockFind = vi.fn().mockResolvedValue({
  docs: [
    {
      id: 1,
      title: 'Hello',
      views: 10,
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    },
  ],
  totalDocs: 1,
  limit: 10,
  page: 1,
  totalPages: 1,
})

const mockFindByID = vi.fn().mockImplementation(({ id }: { id: number }) => {
  if (id === 1) {
    return Promise.resolve({
      id: 1,
      title: 'Hello',
      views: 10,
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    })
  }
  return Promise.resolve(null)
})

const mockCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
  return Promise.resolve({
    id: 2,
    title: data.title,
    views: data.views ?? 0,
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
  } as StoredDoc)
})

const mockUpdate = vi
  .fn()
  .mockImplementation(({ id, data }: { id: number; data: Record<string, unknown> }) => {
    if (id === 1) {
      return Promise.resolve({
        id: 1,
        title: data.title ?? 'Hello',
        views: data.views ?? 10,
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T01:00:00.000Z',
      } as StoredDoc)
    }
    return Promise.resolve(null)
  })

const mockDelete = vi.fn().mockImplementation(({ id }: { id: number }) => {
  if (id === 1) {
    return Promise.resolve({
      id: 1,
      title: 'Hello',
      views: 10,
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    } as StoredDoc)
  }
  return Promise.resolve(null)
})

const adapter: DatabaseAdapter = {
  name: 'mock',
  find: mockFind,
  findByID: mockFindByID,
  create: mockCreate,
  update: mockUpdate,
  delete: mockDelete,
  findGlobal: vi.fn().mockResolvedValue(null),
  updateGlobal: vi.fn().mockResolvedValue(null),
  toSchemaFile: vi.fn().mockReturnValue(''),
  migrate: vi.fn().mockResolvedValue(undefined),
}

describe('createLontar REST API', () => {
  const config: Config = {
    secret: 'test-secret',
    db: adapter,
    collections: [Posts],
  }
  const app = createLontar(config)

  describe('GET /api/:collection', () => {
    it('returns paginated list of documents', async () => {
      const res = await app.request('/api/posts?page=1&limit=5&sort=-views')
      expect(res.status).toBe(200)

      const body = (await res.json()) as { docs: StoredDoc[]; totalDocs: number }
      expect(body.docs).toHaveLength(1)
      expect(body.totalDocs).toBe(1)
      expect(mockFind).toHaveBeenCalledWith({
        collection: Posts,
        page: 1,
        limit: 5,
        sort: '-views',
      })
    })

    it('passes where and sort query parameters to db.find', async () => {
      mockFind.mockClear()
      const res = await app.request(
        '/api/posts?where[status][equals]=published&where[views][greater_than]=10&sort=-createdAt,title',
      )
      expect(res.status).toBe(200)
      expect(mockFind).toHaveBeenCalledWith({
        collection: Posts,
        page: 1,
        limit: 10,
        sort: '-createdAt,title',
        where: {
          status: { equals: 'published' },
          views: { greater_than: '10' },
        },
      })
    })

    it('prevents prototype pollution via where[__proto__] query param', async () => {
      mockFind.mockClear()
      const res = await app.request('/api/posts?where[__proto__][role]=admin')
      expect(res.status).toBe(200)
      expect(({} as Record<string, unknown>).role).toBeUndefined()
    })

    it('prevents prototype pollution via JSON where query param', async () => {
      mockFind.mockClear()
      const jsonParam = encodeURIComponent(JSON.stringify({ __proto__: { role: 'admin' } }))
      const res = await app.request(`/api/posts?where=${jsonParam}`)
      expect(res.status).toBe(200)
      expect(({} as Record<string, unknown>).role).toBeUndefined()
    })

    it('returns 404 for unknown collection', async () => {
      const res = await app.request('/api/unknown')
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/:collection/:id', () => {
    it('returns document by ID', async () => {
      const res = await app.request('/api/posts/1')
      expect(res.status).toBe(200)

      const body = (await res.json()) as StoredDoc
      expect(body.id).toBe(1)
      expect(body.title).toBe('Hello')
    })

    it('returns 404 when document not found', async () => {
      const res = await app.request('/api/posts/999')
      expect(res.status).toBe(404)
    })

    it('returns 400 for non-numeric ID', async () => {
      const res = await app.request('/api/posts/invalid')
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/:collection', () => {
    it('validates input and creates document with 201', async () => {
      const res = await app.request('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Post', views: 42 }),
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as StoredDoc
      expect(body.id).toBe(2)
      expect(body.title).toBe('New Post')
      expect(body.views).toBe(42)
    })

    it('rejects invalid payload with 400 without calling adapter', async () => {
      mockCreate.mockClear()
      const res = await app.request('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ views: -5 }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string; issues: unknown[] }
      expect(body.error).toBe('Validation failed')
      expect(body.issues.length).toBeGreaterThan(0)
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /api/:collection/:id', () => {
    it('validates partial payload and updates document', async () => {
      const res = await app.request('/api/posts/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ views: 50 }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as StoredDoc
      expect(body.views).toBe(50)
      expect(mockUpdate).toHaveBeenCalledWith({
        collection: Posts,
        id: 1,
        data: { views: 50 },
      })
    })

    it('returns 404 when updating non-existent document', async () => {
      const res = await app.request('/api/posts/999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Ghost' }),
      })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/:collection/:id', () => {
    it('deletes document and returns 200', async () => {
      const res = await app.request('/api/posts/1', {
        method: 'DELETE',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as StoredDoc
      expect(body.id).toBe(1)
    })

    it('returns 404 when deleting non-existent document', async () => {
      const res = await app.request('/api/posts/999', {
        method: 'DELETE',
      })

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/_lontar/config', () => {
    it('returns ClientConfig', async () => {
      const res = await app.request('/api/_lontar/config')
      expect(res.status).toBe(200)

      const body = (await res.json()) as { version: number; collections: unknown[] }
      expect(body.version).toBe(1)
      expect(body.collections).toHaveLength(1)
    })
  })

  describe('Better Auth integration and session middleware', () => {
    it('exposes auth instance on lontar app', () => {
      expect(app.auth).toBeDefined()
      expect(typeof app.auth.handler).toBe('function')
    })

    it('mounts auth routes and registers user with session cookie', async () => {
      const res = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Admin',
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { user: { email: string } }
      expect(data.user.email).toBe('admin@example.com')
      expect(res.headers.get('set-cookie')).toBeDefined()
    })

    it('extracts authenticated user via session middleware', async () => {
      const testApp = createLontar(config, { baseURL: 'http://localhost:3000' })

      const signUpRes = await testApp.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'session-user@example.com',
          password: 'password123',
          name: 'Session User',
        }),
      })
      expect(signUpRes.status).toBe(200)
      const cookie = signUpRes.headers.get('set-cookie')
      expect(cookie).toBeTruthy()

      // Request without cookie -> user and session are null
      const unauthRes = await testApp.request('/api/_lontar/me')
      expect(unauthRes.status).toBe(200)
      const unauthBody = (await unauthRes.json()) as { user: unknown; session: unknown }
      expect(unauthBody.user).toBeNull()
      expect(unauthBody.session).toBeNull()

      // Request with session cookie -> user and session are populated
      const authRes = await testApp.request('/api/_lontar/me', {
        headers: { cookie: cookie! },
      })
      expect(authRes.status).toBe(200)
      const authBody = (await authRes.json()) as {
        user: { email: string; name: string } | null
        session: { id: string } | null
      }
      expect(authBody.user).not.toBeNull()
      expect(authBody.user?.email).toBe('session-user@example.com')
      expect(authBody.user?.name).toBe('Session User')
      expect(authBody.session).not.toBeNull()
    })
  })
})
