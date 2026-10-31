import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../auth/types'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { AccessArgs } from '../../config/types'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import { createLontar } from '../create-lontar'

function createMockAdapter(): DatabaseAdapter {
  return {
    name: 'mock',
    find: vi.fn().mockResolvedValue({
      docs: [
        {
          id: 1,
          title: 'First Post',
          createdAt: '2026-10-31T00:00:00.000Z',
          updatedAt: '2026-10-31T00:00:00.000Z',
        },
      ],
      totalDocs: 1,
      limit: 10,
      page: 1,
      totalPages: 1,
    }),
    findByID: vi.fn().mockImplementation(({ id }: { id: number }) => {
      if (id === 1) {
        return Promise.resolve({
          id: 1,
          title: 'First Post',
          createdAt: '2026-10-31T00:00:00.000Z',
          updatedAt: '2026-10-31T00:00:00.000Z',
        })
      }
      return Promise.resolve(null)
    }),
    create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      return Promise.resolve({
        id: 2,
        title: data.title,
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      } as StoredDoc)
    }),
    update: vi
      .fn()
      .mockImplementation(({ id, data }: { id: number; data: Record<string, unknown> }) => {
        if (id === 1) {
          return Promise.resolve({
            id: 1,
            title: data.title ?? 'Updated',
            createdAt: '2026-10-31T00:00:00.000Z',
            updatedAt: '2026-10-31T01:00:00.000Z',
          } as StoredDoc)
        }
        return Promise.resolve(null)
      }),
    delete: vi.fn().mockImplementation(({ id }: { id: number }) => {
      if (id === 1) {
        return Promise.resolve({
          id: 1,
          title: 'First Post',
          createdAt: '2026-10-31T00:00:00.000Z',
          updatedAt: '2026-10-31T00:00:00.000Z',
        } as StoredDoc)
      }
      return Promise.resolve(null)
    }),
    toSchemaFile: vi.fn().mockReturnValue(''),
    migrate: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Collection Access Control', () => {
  it('allows all operations by default when access is not specified', async () => {
    const adapter = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      fields: { title: f.text({ required: true }) },
    })
    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: adapter,
        collections: [posts],
      }),
    )

    // Unauthenticated GET list
    const listRes = await app.request('/api/posts')
    expect(listRes.status).toBe(200)

    // Unauthenticated GET by ID
    const getRes = await app.request('/api/posts/1')
    expect(getRes.status).toBe(200)

    // Unauthenticated POST create
    const createRes = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Post' }),
    })
    expect(createRes.status).toBe(201)

    // Unauthenticated PATCH update
    const updateRes = await app.request('/api/posts/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Post' }),
    })
    expect(updateRes.status).toBe(200)

    // Unauthenticated DELETE
    const deleteRes = await app.request('/api/posts/1', { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)
  })

  it('enforces read access control on list and get by ID', async () => {
    let lastReadArgs: AccessArgs | undefined
    const readSpy = vi.fn((args: AccessArgs) => {
      lastReadArgs = args
      return Boolean(args.user)
    })
    const posts = collection({
      slug: 'posts',
      access: { read: readSpy },
      fields: { title: f.text({ required: true }) },
    })
    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: createMockAdapter(),
        collections: [posts],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    // Unauthenticated -> 401
    const unauthList = await app.request('/api/posts')
    expect(unauthList.status).toBe(401)
    expect(await unauthList.json()).toEqual({ error: 'Unauthorized' })
    expect(readSpy).toHaveBeenLastCalledWith({ user: null })

    const unauthGet = await app.request('/api/posts/1')
    expect(unauthGet.status).toBe(401)
    expect(await unauthGet.json()).toEqual({ error: 'Unauthorized' })
    expect(readSpy).toHaveBeenLastCalledWith({ user: null, id: 1 })

    // Sign up a user
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'reader@example.com',
        password: 'password123',
        name: 'Reader',
      }),
    })
    expect(signUpRes.status).toBe(200)
    const cookie = signUpRes.headers.get('set-cookie')!

    // Authenticated -> 200
    const authList = await app.request('/api/posts', { headers: { cookie } })
    expect(authList.status).toBe(200)
    expect(lastReadArgs?.user?.email).toBe('reader@example.com')

    const authGet = await app.request('/api/posts/1', { headers: { cookie } })
    expect(authGet.status).toBe(200)
    expect(lastReadArgs?.user?.email).toBe('reader@example.com')
    expect(lastReadArgs?.id).toBe(1)
  })

  it('returns 403 Forbidden when authenticated user is denied access', async () => {
    const posts = collection({
      slug: 'posts',
      access: {
        // Only admin role allowed
        delete: ({ user }) => user?.role === 'admin',
      },
      fields: { title: f.text({ required: true }) },
    })
    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: createMockAdapter(),
        collections: [posts],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    // Unauthenticated -> 401
    const unauthRes = await app.request('/api/posts/1', { method: 'DELETE' })
    expect(unauthRes.status).toBe(401)
    expect(await unauthRes.json()).toEqual({ error: 'Unauthorized' })

    // Authenticated (default user has no admin role) -> 403
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'member@example.com',
        password: 'password123',
        name: 'Member',
      }),
    })
    const cookie = signUpRes.headers.get('set-cookie')!

    const forbiddenRes = await app.request('/api/posts/1', {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(forbiddenRes.status).toBe(403)
    expect(await forbiddenRes.json()).toEqual({ error: 'Forbidden' })
  })

  it('enforces create access control and receives user and data', async () => {
    const createSpy = vi
      .fn()
      .mockImplementation(({ user, data }: { user: AuthUser | null; data: unknown }) => {
        if (!user) return false
        const doc = data as { category?: string }
        return doc?.category !== 'forbidden'
      })

    const posts = collection({
      slug: 'posts',
      access: { create: createSpy },
      fields: {
        title: f.text({ required: true }),
        category: f.text(),
      },
    })
    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: createMockAdapter(),
        collections: [posts],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    // Unauthenticated -> 401
    const unauthRes = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Post' }),
    })
    expect(unauthRes.status).toBe(401)
    expect(createSpy).toHaveBeenCalledWith({
      user: null,
      data: { title: 'Post' },
    })

    // Sign up user
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'creator@example.com',
        password: 'password123',
        name: 'Creator',
      }),
    })
    const cookie = signUpRes.headers.get('set-cookie')!

    // Authenticated with forbidden data -> 403
    const forbiddenRes = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Post', category: 'forbidden' }),
    })
    expect(forbiddenRes.status).toBe(403)

    // Authenticated with allowed data -> 201
    const allowedRes = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Post', category: 'general' }),
    })
    expect(allowedRes.status).toBe(201)
  })

  it('enforces update access control and receives user, id, and data', async () => {
    let lastUpdateArgs: AccessArgs | undefined
    const updateSpy = vi.fn((args: AccessArgs) => {
      lastUpdateArgs = args
      return Boolean(args.user)
    })
    const posts = collection({
      slug: 'posts',
      access: { update: updateSpy },
      fields: { title: f.text({ required: true }) },
    })
    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: createMockAdapter(),
        collections: [posts],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    // Unauthenticated -> 401
    const unauthRes = await app.request('/api/posts/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New' }),
    })
    expect(unauthRes.status).toBe(401)
    expect(updateSpy).toHaveBeenCalledWith({
      user: null,
      id: 1,
      data: { title: 'New' },
    })

    // Sign in user
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'updater@example.com',
        password: 'password123',
        name: 'Updater',
      }),
    })
    const cookie = signUpRes.headers.get('set-cookie')!

    // Authenticated -> 200
    const authRes = await app.request('/api/posts/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ title: 'New' }),
    })
    expect(authRes.status).toBe(200)
    expect(lastUpdateArgs?.user?.email).toBe('updater@example.com')
    expect(lastUpdateArgs?.id).toBe(1)
    expect(lastUpdateArgs?.data).toEqual({ title: 'New' })
  })

  it('enforces delete access control and receives user and id', async () => {
    let lastDeleteArgs: AccessArgs | undefined
    const deleteSpy = vi.fn((args: AccessArgs) => {
      lastDeleteArgs = args
      return Boolean(args.user)
    })
    const posts = collection({
      slug: 'posts',
      access: { delete: deleteSpy },
      fields: { title: f.text({ required: true }) },
    })
    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: createMockAdapter(),
        collections: [posts],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    // Unauthenticated -> 401
    const unauthRes = await app.request('/api/posts/1', { method: 'DELETE' })
    expect(unauthRes.status).toBe(401)
    expect(deleteSpy).toHaveBeenCalledWith({ user: null, id: 1 })

    // Sign in user
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'deleter@example.com',
        password: 'password123',
        name: 'Deleter',
      }),
    })
    const cookie = signUpRes.headers.get('set-cookie')!

    // Authenticated -> 200
    const authRes = await app.request('/api/posts/1', {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(authRes.status).toBe(200)
    expect(lastDeleteArgs?.user?.email).toBe('deleter@example.com')
    expect(lastDeleteArgs?.id).toBe(1)
  })

  it('supports async access functions', async () => {
    const posts = collection({
      slug: 'posts',
      access: {
        read: async () => {
          await new Promise((r) => setTimeout(r, 10))
          return false
        },
      },
      fields: { title: f.text({ required: true }) },
    })
    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: createMockAdapter(),
        collections: [posts],
      }),
    )

    const res = await app.request('/api/posts')
    expect(res.status).toBe(401)
  })

  it('fails closed when an access function throws an exception', async () => {
    const posts = collection({
      slug: 'posts',
      access: {
        read: () => {
          throw new Error('Boom in access function')
        },
      },
      fields: { title: f.text({ required: true }) },
    })
    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: createMockAdapter(),
        collections: [posts],
      }),
    )

    const res = await app.request('/api/posts')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })
})
