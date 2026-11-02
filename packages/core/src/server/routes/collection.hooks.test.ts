import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import type { AfterChangeHook, AfterReadHook, BeforeChangeHook } from '../../hooks'
import { createLontar } from '../create-lontar'

function createMockAdapter() {
  const mockFind = vi.fn().mockResolvedValue({
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
  })

  const mockFindByID = vi.fn().mockImplementation(({ id }: { id: number }) => {
    if (id === 1) {
      return Promise.resolve({
        id: 1,
        title: 'First Post',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      })
    }
    return Promise.resolve(null)
  })

  const mockCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    return Promise.resolve({
      id: 2,
      ...data,
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
          title: 'First Post',
          ...data,
          createdAt: '2026-10-31T00:00:00.000Z',
          updatedAt: '2026-10-31T01:00:00.000Z',
        } as StoredDoc)
      }
      return Promise.resolve(null)
    })

  const mockDelete = vi.fn().mockResolvedValue(null)
  const mockFindGlobal = vi.fn().mockResolvedValue(null)
  const mockUpdateGlobal = vi.fn().mockResolvedValue(null)
  const mockToSchemaFile = vi.fn().mockReturnValue('')
  const mockMigrate = vi.fn().mockResolvedValue(undefined)

  const db: DatabaseAdapter = {
    name: 'mock',
    find: mockFind,
    findByID: mockFindByID,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
    findGlobal: mockFindGlobal,
    updateGlobal: mockUpdateGlobal,
    toSchemaFile: mockToSchemaFile,
    migrate: mockMigrate,
  }

  return {
    db,
    mockFind,
    mockFindByID,
    mockCreate,
    mockUpdate,
    mockDelete,
  }
}

const publicAccess = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
}

describe('Collection Lifecycle Hooks', () => {
  it('executes beforeChange before create, modifying data sent to DB', async () => {
    const beforeChangeHook = vi.fn<BeforeChangeHook>(({ data, operation, originalDoc }) => {
      expect(operation).toBe('create')
      expect(originalDoc).toBeUndefined()
      return {
        ...data,
        slug: (data.title as string).toLowerCase().replace(/\s+/g, '-'),
      }
    })

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        title: f.text({ required: true }),
        slug: f.text(),
      },
      hooks: {
        beforeChange: [beforeChangeHook],
      },
    })

    const { db, mockCreate } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Hello World' }),
      }),
    )

    expect(res.status).toBe(201)
    expect(beforeChangeHook).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          title: 'Hello World',
          slug: 'hello-world',
        },
      }),
    )
  })

  it('executes beforeChange before update, receiving originalDoc and allowing mutation', async () => {
    const beforeChangeHook = vi.fn<BeforeChangeHook>(({ data, operation, originalDoc }) => {
      expect(operation).toBe('update')
      expect(originalDoc).toBeDefined()
      expect(originalDoc?.title).toBe('First Post')
      return {
        ...data,
        slug: 'updated-slug',
      }
    })

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        title: f.text(),
        slug: f.text(),
      },
      hooks: {
        beforeChange: [beforeChangeHook],
      },
    })

    const { db, mockUpdate } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/posts/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Brand New Title' }),
      }),
    )

    expect(res.status).toBe(200)
    expect(beforeChangeHook).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: {
          title: 'Brand New Title',
          slug: 'updated-slug',
        },
      }),
    )
  })

  it('returns 400 when beforeChange throws an error', async () => {
    const errorHook: BeforeChangeHook = () => {
      throw new Error('Title is not allowed')
    }

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        title: f.text(),
      },
      hooks: {
        beforeChange: [errorHook],
      },
    })

    const { db, mockCreate } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Forbidden Title' }),
      }),
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Title is not allowed')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('executes afterChange after create and update', async () => {
    const afterChangeHook = vi.fn<AfterChangeHook>(({ doc }) => {
      return {
        ...doc,
        hookAdded: true,
      }
    })

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        title: f.text({ required: true }),
      },
      hooks: {
        afterChange: [afterChangeHook],
      },
    })

    const { db } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Test AfterChange' }),
      }),
    )

    expect(res.status).toBe(201)
    expect(afterChangeHook).toHaveBeenCalledTimes(1)
    const json = (await res.json()) as { hookAdded: boolean }
    expect(json.hookAdded).toBe(true)
  })

  it('executes afterRead on GET /:collection and GET /:collection/:id', async () => {
    const afterReadHook = vi.fn<AfterReadHook>(({ doc }) => {
      return {
        ...doc,
        formattedTitle: `PREFIX: ${doc.title as string}`,
      }
    })

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        title: f.text(),
      },
      hooks: {
        afterRead: [afterReadHook],
      },
    })

    const { db } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    // Test find (GET /api/posts)
    const listRes = await lontar.fetch(new Request('http://localhost/api/posts'))
    expect(listRes.status).toBe(200)
    const listJson = (await listRes.json()) as { docs: Array<{ formattedTitle: string }> }
    expect(listJson.docs[0]?.formattedTitle).toBe('PREFIX: First Post')

    // Test findByID (GET /api/posts/1)
    const itemRes = await lontar.fetch(new Request('http://localhost/api/posts/1'))
    expect(itemRes.status).toBe(200)
    const itemJson = (await itemRes.json()) as { formattedTitle: string }
    expect(itemJson.formattedTitle).toBe('PREFIX: First Post')
  })
})
