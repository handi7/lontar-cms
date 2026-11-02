import { describe, expect, it, vi } from 'vitest'
import { Posts } from '../__fixtures__/posts'
import {
  collection,
  defineConfig,
  fields,
  type Config,
  type DatabaseAdapter,
  type StoredDoc,
} from '../index'
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
        '/api/posts?where[title][equals]=hello&where[views][greater_than]=10&sort=-createdAt,title',
      )
      expect(res.status).toBe(200)
      expect(mockFind).toHaveBeenCalledWith({
        collection: Posts,
        page: 1,
        limit: 10,
        sort: '-createdAt,title',
        where: {
          title: { equals: 'hello' },
          views: { greater_than: '10' },
        },
      })
    })

    it('returns 400 when where query contains unknown fields', async () => {
      mockFind.mockClear()
      const res = await app.request('/api/posts?where[titel][equals]=nope')
      expect(res.status).toBe(400)
      const body = (await res.json()) as {
        error: string
        issues: { path: string; message: string }[]
      }
      expect(body.error).toBe('Validation failed')
      expect(body.issues).toContainEqual({
        path: 'titel',
        message: 'Unknown field "titel"',
      })
      expect(mockFind).not.toHaveBeenCalled()
    })

    it('returns 400 when where query contains unknown operators', async () => {
      mockFind.mockClear()
      const res = await app.request('/api/posts?where[title][eqauls]=x')
      expect(res.status).toBe(400)
      const body = (await res.json()) as {
        error: string
        issues: { path: string; message: string }[]
      }
      expect(body.error).toBe('Validation failed')
      expect(body.issues).toContainEqual({
        path: 'title.eqauls',
        message: 'Unknown operator "eqauls"',
      })
      expect(mockFind).not.toHaveBeenCalled()
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

    it('clamps limit exceeding default maximum limit of 100', async () => {
      mockFind.mockClear()
      const res = await app.request('/api/posts?limit=100000000')
      expect(res.status).toBe(200)
      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: Posts,
          limit: 100,
        }),
      )
    })

    it('falls back to defaultLimit for non-positive or non-numeric limit values', async () => {
      for (const query of ['limit=0', 'limit=-10', 'limit=not-a-number']) {
        mockFind.mockClear()
        const res = await app.request(`/api/posts?${query}`)
        expect(res.status).toBe(200)
        expect(mockFind).toHaveBeenCalledWith(
          expect.objectContaining({
            collection: Posts,
            limit: 10,
          }),
        )
      }
    })

    it('respects collection-level and config-level custom pagination limits', async () => {
      const customPost = collection({
        slug: 'articles',
        access: {
          read: () => true,
        },
        pagination: { defaultLimit: 25, maxLimit: 50 },
        fields: { title: fields.text({ required: true }) },
      })
      const customApp = createLontar(
        defineConfig({
          secret: 'test-secret',
          db: {
            ...adapter,
            find: mockFind,
          },
          pagination: { defaultLimit: 20, maxLimit: 80 },
          collections: [customPost],
        }),
      )

      mockFind.mockClear()
      // Request with no limit uses collection's defaultLimit (25)
      await customApp.request('/api/articles')
      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: customPost,
          limit: 25,
        }),
      )

      mockFind.mockClear()
      // Request exceeding collection's maxLimit (50) is clamped to 50
      await customApp.request('/api/articles?limit=999')
      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: customPost,
          limit: 50,
        }),
      )
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

    it('disables public email sign-up by default', async () => {
      const res = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'public-signup@example.com',
          password: 'password123',
          name: 'Public Attacker',
        }),
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as { code?: string }
      expect(data.code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED')
    })

    it('supports first-user onboarding and blocks subsequent registrations', async () => {
      const testApp = createLontar(config, { baseURL: 'http://localhost:3000' })

      // Check initially that first user can be created
      const initialCheck = await testApp.request('/api/_lontar/first-user')
      expect(initialCheck.status).toBe(200)
      const checkData = (await initialCheck.json()) as { canRegisterFirstUser: boolean }
      expect(checkData.canRegisterFirstUser).toBe(true)

      // Register first user
      const registerRes = await testApp.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'first-admin@example.com',
          password: 'password123',
          name: 'First Admin',
        }),
      })

      expect(registerRes.status).toBe(200)
      const cookie = registerRes.headers.get('set-cookie')
      expect(cookie).toBeTruthy()

      // Attempting to register another user via first-user endpoint must fail with 403
      const secondRes = await testApp.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'second-user@example.com',
          password: 'password123',
          name: 'Second User',
        }),
      })
      expect(secondRes.status).toBe(403)
      const secondData = (await secondRes.json()) as { error: string }
      expect(secondData.error).toContain('First user has already been created')
    })

    it('extracts authenticated user via session middleware', async () => {
      const testApp = createLontar(config, { baseURL: 'http://localhost:3000' })

      const registerRes = await testApp.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'session-user@example.com',
          password: 'password123',
          name: 'Session User',
        }),
      })
      expect(registerRes.status).toBe(200)
      const cookie = registerRes.headers.get('set-cookie')
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
