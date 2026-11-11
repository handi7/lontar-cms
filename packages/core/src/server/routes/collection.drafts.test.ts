import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../auth/types'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import type { AfterChangeHook, BeforeChangeHook } from '../../hooks'
import { getLontar } from '../../local'
import { createLontar } from '../create-lontar'

function createMockAdapter(initialDocs: StoredDoc[] = []) {
  let docs = [...initialDocs]

  const mockFind = vi.fn().mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
    let result = docs
    if (where && '_status' in where) {
      const statusClause = where._status as { equals?: string } | undefined
      if (statusClause?.equals) {
        result = result.filter((d) => d._status === statusClause.equals)
      }
    }
    return Promise.resolve({
      docs: result,
      totalDocs: result.length,
      limit: 10,
      page: 1,
      totalPages: 1,
      whereUsed: where,
    })
  })

  const mockFindByID = vi.fn().mockImplementation(({ id }: { id: number }) => {
    const doc = docs.find((d) => d.id === id)
    return Promise.resolve(doc ? { ...doc } : null)
  })

  const mockCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    const newDoc: StoredDoc = {
      id: docs.length + 1,
      ...data,
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    }
    docs.push(newDoc)
    return Promise.resolve({ ...newDoc })
  })

  const mockUpdate = vi
    .fn()
    .mockImplementation(({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const idx = docs.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const existing = docs[idx]!
      const updated: StoredDoc = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: '2026-10-31T01:00:00.000Z',
      }
      docs[idx] = updated
      return Promise.resolve({ ...updated })
    })

  const mockDelete = vi.fn().mockImplementation(({ id }: { id: number }) => {
    const doc = docs.find((d) => d.id === id)
    if (!doc) return Promise.resolve(null)
    docs = docs.filter((d) => d.id !== id)
    return Promise.resolve({ ...doc })
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

  return {
    adapter,
    mockFind,
    mockFindByID,
    mockCreate,
    mockUpdate,
    mockDelete,
    getDocs: () => docs,
  }
}

describe('Drafts, _status field, and draft-aware reads', () => {
  it('enforces update access when requesting ?draft=true on find and findByID', async () => {
    const initialDocs: StoredDoc[] = [
      {
        id: 1,
        title: 'Draft Post',
        _status: 'draft',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
      {
        id: 2,
        title: 'Published Post',
        _status: 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const { adapter, mockFind } = createMockAdapter(initialDocs)
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => true,
        update: ({ user }) => Boolean(user),
      },
      fields: { title: f.text({ required: true }) },
    })

    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: adapter,
        collections: [posts],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    // Unauthenticated GET /api/posts filters by _status: 'published'
    const publicList = await app.request('/api/posts')
    expect(publicList.status).toBe(200)
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { _status: { equals: 'published' } },
      }),
    )

    // Unauthenticated GET /api/posts?draft=true -> 401 Unauthorized
    const deniedList = await app.request('/api/posts?draft=true')
    expect(deniedList.status).toBe(401)

    // Unauthenticated GET /api/posts/1 (draft doc) -> 404
    const draftById = await app.request('/api/posts/1')
    expect(draftById.status).toBe(404)

    // Unauthenticated GET /api/posts/2 (published doc) -> 200
    const publishedById = await app.request('/api/posts/2')
    expect(publishedById.status).toBe(200)
    const publishedJson = (await publishedById.json()) as Record<string, unknown>
    expect(publishedJson.id).toBe(2)
    expect(publishedJson._status).toBe('published')

    // Unauthenticated GET /api/posts/1?draft=true -> 401
    const deniedGet = await app.request('/api/posts/1?draft=true')
    expect(deniedGet.status).toBe(401)

    // Sign in user
    const signUpRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'editor@example.com',
        password: 'password123',
        name: 'Editor',
      }),
    })
    expect(signUpRes.status).toBe(200)
    const cookie = signUpRes.headers.get('set-cookie')!

    // Authenticated GET /api/posts?draft=true -> 200, no _status filter
    const authList = await app.request('/api/posts?draft=true', { headers: { cookie } })
    expect(authList.status).toBe(200)
    expect(mockFind).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: undefined,
      }),
    )

    // Authenticated GET /api/posts/1?draft=true -> 200
    const authGet = await app.request('/api/posts/1?draft=true', { headers: { cookie } })
    expect(authGet.status).toBe(200)
    const authDoc = (await authGet.json()) as Record<string, unknown>
    expect(authDoc.id).toBe(1)
    expect(authDoc._status).toBe('draft')
  })

  it('sets _status to draft on create when ?draft=true, and published otherwise', async () => {
    const beforeChangeHook = vi.fn()
    const afterChangeHook = vi.fn()

    const { adapter } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      hooks: {
        beforeChange: [beforeChangeHook as unknown as BeforeChangeHook],
        afterChange: [afterChangeHook as unknown as AfterChangeHook],
      },
      fields: { title: f.text({ required: true }) },
    })

    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: adapter,
        collections: [posts],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    const signUpRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'author@example.com',
        password: 'password123',
        name: 'Author',
      }),
    })
    const cookie = signUpRes.headers.get('set-cookie')!

    // POST without ?draft=true creates published doc
    const resPub = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Published Article' }),
    })
    expect(resPub.status).toBe(201)
    const pubDoc = (await resPub.json()) as Record<string, unknown>
    expect(pubDoc._status).toBe('published')
    expect(beforeChangeHook).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'published',
        statusTransition: 'published',
      }),
    )

    // POST with ?draft=true creates draft doc
    const resDraft = await app.request('/api/posts?draft=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Article' }),
    })
    expect(resDraft.status).toBe(201)
    const draftDoc = (await resDraft.json()) as Record<string, unknown>
    expect(draftDoc._status).toBe('draft')
    expect(beforeChangeHook).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'draft',
        statusTransition: 'draft',
      }),
    )

    // POST with ?autosave=true creates draft doc and is hidden from public read (#284)
    const resAutosave = await app.request('/api/posts?autosave=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Autosaved Article' }),
    })
    expect(resAutosave.status).toBe(201)
    const autosaveDoc = (await resAutosave.json()) as Record<string, unknown>
    expect(autosaveDoc._status).toBe('draft')
    expect(beforeChangeHook).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'draft',
        statusTransition: 'draft',
      }),
    )

    // Read with cookie but without draft=true should hide the autosaved draft doc
    const resWithoutDraft = await app.request('/api/posts', {
      headers: { cookie },
    })
    expect(resWithoutDraft.status).toBe(200)
    const bodyWithoutDraft = (await resWithoutDraft.json()) as {
      docs: Array<{ id: number; title: string }>
    }
    expect(bodyWithoutDraft.docs.some((d) => d.id === autosaveDoc.id)).toBe(false)
    expect(bodyWithoutDraft.docs.some((d) => d.id === pubDoc.id)).toBe(true)

    // Read with draft=true should include the autosaved draft doc
    const resWithDraft = await app.request('/api/posts?draft=true', {
      headers: { cookie },
    })
    expect(resWithDraft.status).toBe(200)
    const bodyWithDraft = (await resWithDraft.json()) as {
      docs: Array<{ id: number; title: string }>
    }
    expect(bodyWithDraft.docs.some((d) => d.id === autosaveDoc.id)).toBe(true)
  })

  it('publishes and unpublishes documents via dedicated endpoints', async () => {
    const beforeChangeHook = vi.fn()
    const afterChangeHook = vi.fn()

    const initialDocs: StoredDoc[] = [
      {
        id: 1,
        title: 'Existing Draft',
        _status: 'draft',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const { adapter, getDocs } = createMockAdapter(initialDocs)
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      hooks: {
        beforeChange: [beforeChangeHook as unknown as BeforeChangeHook],
        afterChange: [afterChangeHook as unknown as AfterChangeHook],
      },
      fields: { title: f.text({ required: true }) },
    })

    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: adapter,
        collections: [posts],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    const signUpRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'publisher@example.com',
        password: 'password123',
        name: 'Publisher',
      }),
    })
    const cookie = signUpRes.headers.get('set-cookie')!

    // Publish doc
    const publishRes = await app.request('/api/posts/1/publish', {
      method: 'POST',
      headers: { cookie },
    })
    expect(publishRes.status).toBe(200)
    const published = (await publishRes.json()) as Record<string, unknown>
    expect(published._status).toBe('published')
    expect(getDocs()[0]?._status).toBe('published')
    expect(beforeChangeHook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'published',
        previousStatus: 'draft',
        statusTransition: 'publish',
      }),
    )
    expect(afterChangeHook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'published',
        previousStatus: 'draft',
        statusTransition: 'publish',
      }),
    )

    // Unpublish doc
    const unpublishRes = await app.request('/api/posts/1/unpublish', {
      method: 'POST',
      headers: { cookie },
    })
    expect(unpublishRes.status).toBe(200)
    const unpublished = (await unpublishRes.json()) as Record<string, unknown>
    expect(unpublished._status).toBe('draft')
    expect(getDocs()[0]?._status).toBe('draft')
    expect(beforeChangeHook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        previousStatus: 'published',
        statusTransition: 'unpublish',
      }),
    )
    expect(afterChangeHook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        previousStatus: 'published',
        statusTransition: 'unpublish',
      }),
    )

    // Publish non-existent doc -> 404
    const notFoundRes = await app.request('/api/posts/999/publish', {
      method: 'POST',
      headers: { cookie },
    })
    expect(notFoundRes.status).toBe(404)
  })

  it('rejects publish/unpublish when drafts are not enabled for collection', async () => {
    const { adapter } = createMockAdapter([
      {
        id: 1,
        title: 'Simple Note',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ])

    const notes = collection({
      slug: 'notes',
      fields: { title: f.text({ required: true }) },
    })

    const app = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: adapter,
        collections: [notes],
      }),
      { baseURL: 'http://localhost:3000' },
    )

    const signUpRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin',
      }),
    })
    const cookie = signUpRes.headers.get('set-cookie')!

    const res = await app.request('/api/notes/1/publish', {
      method: 'POST',
      headers: { cookie },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Drafts are not enabled for collection "notes"',
    })
  })

  it('supports draft flag and publish/unpublish in Local API client', async () => {
    const initialDocs: StoredDoc[] = [
      {
        id: 1,
        title: 'First Post',
        _status: 'draft',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const { adapter, mockFind } = createMockAdapter(initialDocs)
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      fields: { title: f.text({ required: true }) },
    })

    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [posts],
    })

    const client = await getLontar(config)

    // Find with draft: true
    await client.find('posts', { draft: true })
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: undefined,
      }),
    )

    // Publish
    const published = await client.publish('posts', 1)
    expect(published._status).toBe('published')

    // Unpublish
    const unpublished = await client.unpublish('posts', 1)
    expect(unpublished._status).toBe('draft')

    // Create with autosave: true forces draft (#284)
    const autosaved = await client.create<Record<string, unknown>>('posts', {
      data: { title: 'Autosaved Local' },
      autosave: true,
    })
    expect(autosaved._status).toBe('draft')
  })

  it('filters unpublished related documents when draft is false during population', async () => {
    const postDocs: StoredDoc[] = [
      {
        id: 1,
        title: 'Post with Draft Category',
        category: 10,
        _status: 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const categoryDocs: StoredDoc[] = [
      {
        id: 10,
        name: 'Draft Category',
        _status: 'draft',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const adapter: DatabaseAdapter = {
      name: 'mock',
      find: vi
        .fn()
        .mockImplementation(
          ({
            collection: col,
            where,
          }: {
            collection: { slug: string }
            where?: Record<string, unknown>
          }) => {
            const pool = col.slug === 'categories' ? categoryDocs : postDocs
            let docs = pool.map((d) => ({ ...d }))
            const andConds = (where?.and as Array<Record<string, unknown>>) ?? []
            if (andConds.some((c) => (c._status as { equals?: string })?.equals === 'published')) {
              docs = docs.filter((d) => d._status === 'published')
            }
            return Promise.resolve({
              docs,
              totalDocs: docs.length,
              limit: 10,
              page: 1,
              totalPages: 1,
              whereUsed: where,
            })
          },
        ),
      findByID: vi
        .fn()
        .mockImplementation(
          ({ collection: col, id }: { collection: { slug: string }; id: number }) => {
            const pool = col.slug === 'categories' ? categoryDocs : postDocs
            const doc = pool.find((d) => d.id === id)
            return Promise.resolve(doc ? { ...doc } : null)
          },
        ),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findGlobal: vi.fn().mockResolvedValue(null),
      updateGlobal: vi.fn().mockResolvedValue(null),
      toSchemaFile: vi.fn().mockReturnValue(''),
      migrate: vi.fn().mockResolvedValue(undefined),
    }

    const categories = collection({
      slug: 'categories',
      versions: { drafts: true },
      fields: { name: f.text({ required: true }) },
    })

    const posts = collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true }),
        category: f.relationship({ relationTo: 'categories' }),
      },
    })

    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [categories, posts],
    })

    const client = await getLontar(config)

    // With draft: false (default), the draft category is filtered out and resolves to null
    const docPublic = await client.findByID('posts', 1, { depth: 1, draft: false })
    expect(docPublic?.category).toBeNull()

    // With draft: true, the draft category is populated
    const docDraft = await client.findByID('posts', 1, { depth: 1, draft: true })
    expect(docDraft?.category).toMatchObject({
      id: 10,
      name: 'Draft Category',
      _status: 'draft',
    })
  })

  it('enforces update access on target collection before populating draft targets', async () => {
    const categoryDocs: StoredDoc[] = [
      {
        id: 10,
        name: 'Live Category',
        _status: 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
      {
        id: 20,
        name: 'Draft Only Category',
        _status: 'draft',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const postDocs: StoredDoc[] = [
      {
        id: 1,
        title: 'Post 1',
        category: 10,
        _status: 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
      {
        id: 2,
        title: 'Post 2',
        category: 20,
        _status: 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const adapter: DatabaseAdapter = {
      name: 'mock',
      find: vi
        .fn()
        .mockImplementation(
          ({
            collection: col,
            where,
          }: {
            collection: { slug: string }
            where?: Record<string, unknown>
          }) => {
            const pool = col.slug === 'categories' ? categoryDocs : postDocs
            let docs = pool.map((d) => ({ ...d }))
            const andConds = (where?.and as Array<Record<string, unknown>>) ?? []
            if (andConds.some((c) => (c._status as { equals?: string })?.equals === 'published')) {
              docs = docs.filter((d) => d._status === 'published')
            }
            return Promise.resolve({
              docs,
              totalDocs: docs.length,
              limit: 10,
              page: 1,
              totalPages: 1,
              whereUsed: where,
            })
          },
        ),
      findByID: vi
        .fn()
        .mockImplementation(
          ({ collection: col, id }: { collection: { slug: string }; id: number }) => {
            const pool = col.slug === 'categories' ? categoryDocs : postDocs
            const doc = pool.find((d) => d.id === id)
            return Promise.resolve(doc ? { ...doc } : null)
          },
        ),
      findLatestDraftVersion: vi
        .fn()
        .mockImplementation(
          ({ collection: col, parentId }: { collection: { slug: string }; parentId: number }) => {
            if (col.slug === 'categories' && parentId === 10) {
              return Promise.resolve({
                id: 99,
                parentId: 10,
                versionNumber: 2,
                snapshot: { id: 10, name: 'Live Category WIP Draft', _status: 'draft' },
                _status: 'draft',
                autosave: false,
                createdAt: '2026-10-31T00:00:00.000Z',
                createdBy: null,
              })
            }
            return Promise.resolve(null)
          },
        ),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findGlobal: vi.fn().mockResolvedValue(null),
      updateGlobal: vi.fn().mockResolvedValue(null),
      toSchemaFile: vi.fn().mockReturnValue(''),
      migrate: vi.fn().mockResolvedValue(undefined),
    }

    const categories = collection({
      slug: 'categories',
      versions: { drafts: true },
      fields: { name: f.text({ required: true }) },
      access: {
        read: () => true,
        update: ({ user }) => (user as { role?: string } | undefined)?.role === 'admin',
      },
    })

    const posts = collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true }),
        category: f.relationship({ relationTo: 'categories' }),
      },
      access: {
        read: () => true,
        update: () => true,
      },
    })

    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [categories, posts],
    })

    const client = await getLontar(config)

    // User without update access on categories requesting draft=true
    const regularUser = {
      id: 'reader',
      email: 'reader@example.com',
      role: 'reader',
    } as unknown as AuthUser
    const resReader = await client.find('posts', {
      depth: 1,
      draft: true,
      user: regularUser,
      overrideAccess: false,
    })
    const readerDocs = resReader.docs as Array<Record<string, unknown>>
    // Category 10 has published row -> returned as published, not the WIP draft snapshot
    expect(readerDocs[0]?.category).toMatchObject({
      id: 10,
      name: 'Live Category',
      _status: 'published',
    })
    // Category 20 is draft-only -> resolved to null
    expect(readerDocs[1]?.category).toBeNull()

    // Admin user with update access on categories requesting draft=true
    const adminUser = {
      id: 'admin',
      email: 'admin@example.com',
      role: 'admin',
    } as unknown as AuthUser
    const resAdmin = await client.find('posts', {
      depth: 1,
      draft: true,
      user: adminUser,
      overrideAccess: false,
    })
    const adminDocs = resAdmin.docs as Array<Record<string, unknown>>
    // Hydrated with latest draft snapshot
    expect(adminDocs[0]?.category).toMatchObject({
      id: 10,
      name: 'Live Category WIP Draft',
      _status: 'draft',
    })
    // Draft-only category populated
    expect(adminDocs[1]?.category).toMatchObject({
      id: 20,
      name: 'Draft Only Category',
      _status: 'draft',
    })
  })
})
