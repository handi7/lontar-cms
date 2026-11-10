import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import type {
  AfterChangeHook,
  AfterDeleteHook,
  AfterReadHook,
  BeforeChangeHook,
  BeforeDeleteHook,
  BeforeValidateHook,
} from '../../hooks'
import { createLontar } from '../create-lontar'

function createMockAdapter() {
  const store = new Map<number, StoredDoc>([
    [
      1,
      {
        id: 1,
        title: 'First Post',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ],
  ])
  let nextId = 2

  const mockFind = vi.fn().mockImplementation(() =>
    Promise.resolve({
      docs: Array.from(store.values()),
      totalDocs: store.size,
      limit: 10,
      page: 1,
      totalPages: 1,
    }),
  )

  const mockFindByID = vi.fn().mockImplementation(({ id }: { id: number }) => {
    const doc = store.get(id)
    return Promise.resolve(doc ? { ...doc } : null)
  })

  const mockCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    const id = nextId++
    const doc: StoredDoc = {
      id,
      ...data,
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    }
    store.set(id, doc)
    return Promise.resolve({ ...doc })
  })

  const mockUpdate = vi
    .fn()
    .mockImplementation(({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const existing = store.get(id)
      if (existing) {
        const updated: StoredDoc = {
          ...existing,
          ...data,
          updatedAt: '2026-10-31T01:00:00.000Z',
        }
        store.set(id, updated)
        return Promise.resolve({ ...updated })
      }
      return Promise.resolve(null)
    })

  const mockDelete = vi.fn().mockResolvedValue(null)
  const mockFindGlobal = vi.fn().mockResolvedValue(null)
  const mockUpdateGlobal = vi.fn().mockResolvedValue(null)
  const mockToSchemaFile = vi.fn().mockReturnValue('')
  const mockMigrate = vi.fn().mockResolvedValue(undefined)
  const mockTransaction = vi
    .fn()
    .mockImplementation((cb: (txDb: DatabaseAdapter) => unknown) => cb(db))

  const db: DatabaseAdapter = {
    name: 'mock',
    find: mockFind,
    findByID: mockFindByID,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
    findGlobal: mockFindGlobal,
    updateGlobal: mockUpdateGlobal,
    transaction: mockTransaction,
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
    mockTransaction,
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

  it('returns 500 when beforeChange throws an error', async () => {
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

    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Internal Server Error')
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

  it('runs create within a database transaction and bubbles error when afterChange throws', async () => {
    const afterChangeHook = vi.fn<AfterChangeHook>(() => {
      throw new Error('afterChange failure')
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

    const { db, mockTransaction } = createMockAdapter()
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
        body: JSON.stringify({ title: 'Transaction Test' }),
      }),
    )

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
  })

  it('runs beforeValidate to normalize data before Zod validation runs', async () => {
    const beforeValidateHook: BeforeValidateHook = ({ data }) => {
      // Normalize missing or untrimmed title
      if (typeof data.title === 'string') {
        data.title = data.title.trim()
      }
      return data
    }

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        // Requires title with minLength 3
        title: f.text({ required: true }),
      },
      hooks: {
        beforeValidate: [beforeValidateHook],
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

    // Sending title with surrounding whitespace
    const res = await lontar.fetch(
      new Request('http://localhost/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '   Clean Title   ' }),
      }),
    )

    expect(res.status).toBe(201)
    const callArgs = mockCreate.mock.calls[0]?.[0] as { data: { title: string } }
    expect(callArgs.data.title).toBe('Clean Title')
  })

  it('executes hooks in the exact lifecycle order: beforeValidate -> beforeChange -> DB write -> afterChange', async () => {
    const order: string[] = []

    const beforeValidateHook: BeforeValidateHook = () => {
      order.push('beforeValidate')
    }
    const beforeChangeHook: BeforeChangeHook = () => {
      order.push('beforeChange')
    }
    const afterChangeHook: AfterChangeHook = () => {
      order.push('afterChange')
    }

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        title: f.text({ required: true }),
      },
      hooks: {
        beforeValidate: [beforeValidateHook],
        beforeChange: [beforeChangeHook],
        afterChange: [afterChangeHook],
      },
    })

    const { db, mockCreate } = createMockAdapter()
    mockCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      order.push('dbWrite')
      return Promise.resolve({
        id: 10,
        ...data,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:00.000Z',
      } as StoredDoc)
    })

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
        body: JSON.stringify({ title: 'Order Test' }),
      }),
    )

    expect(res.status).toBe(201)
    expect(order).toEqual(['beforeValidate', 'beforeChange', 'dbWrite', 'afterChange'])
  })

  it('runs beforeDelete inside the delete transaction and aborts delete when it throws', async () => {
    const beforeDeleteHook = vi.fn<BeforeDeleteHook>(() => {
      throw new Error('Deletion rejected by beforeDelete hook')
    })
    const afterDeleteHook = vi.fn<AfterDeleteHook>()

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        title: f.text({ required: true }),
      },
      hooks: {
        beforeDelete: [beforeDeleteHook],
        afterDelete: [afterDeleteHook],
      },
    })

    const { db, mockDelete, mockFindByID, mockTransaction } = createMockAdapter()
    mockFindByID.mockResolvedValue({
      id: 1,
      title: 'Protected Post',
      createdAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:00.000Z',
    })

    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/posts/1', {
        method: 'DELETE',
      }),
    )

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(beforeDeleteHook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
      }),
    )
    expect(beforeDeleteHook.mock.calls[0]?.[0]?.doc.title).toBe('Protected Post')
    // mockDelete and afterDelete MUST NOT have been called because beforeDelete aborted
    expect(mockDelete).not.toHaveBeenCalled()
    expect(afterDeleteHook).not.toHaveBeenCalled()
    expect(res.status).toBe(500)
  })

  it('runs afterDelete after transaction commits on successful delete', async () => {
    const beforeDeleteHook = vi.fn<BeforeDeleteHook>()
    const afterDeleteHook = vi.fn<AfterDeleteHook>(({ doc }) => ({
      ...doc,
      deletedCleanly: true,
    }))

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      fields: {
        title: f.text({ required: true }),
      },
      hooks: {
        beforeDelete: [beforeDeleteHook],
        afterDelete: [afterDeleteHook],
      },
    })

    const { db, mockDelete, mockFindByID } = createMockAdapter()
    mockFindByID.mockResolvedValue({
      id: 1,
      title: 'Deleting Post',
      createdAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:00.000Z',
    })
    mockDelete.mockResolvedValue({
      id: 1,
      title: 'Deleting Post',
    })

    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/posts/1', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(200)
    expect(beforeDeleteHook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
      }),
    )
    expect(beforeDeleteHook.mock.calls[0]?.[0]?.doc.title).toBe('Deleting Post')
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
      }),
    )
    expect(afterDeleteHook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
      }),
    )
    expect(afterDeleteHook.mock.calls[0]?.[0]?.doc.title).toBe('Deleting Post')
    const json = (await res.json()) as Record<string, unknown>
    expect(json.id).toBe(1)
    expect(json.deletedCleanly).toBe(true)
  })

  it('passes status and statusTransition to beforeValidate and mutation hooks when drafts are enabled', async () => {
    const beforeValidateHook = vi.fn<BeforeValidateHook>()
    const beforeChangeHook = vi.fn<BeforeChangeHook>()
    const afterChangeHook = vi.fn<AfterChangeHook>()

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      versions: {
        drafts: true,
      },
      fields: {
        title: f.text({ required: true }),
      },
      hooks: {
        beforeValidate: [beforeValidateHook],
        beforeChange: [beforeChangeHook],
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

    // Save as draft
    const resDraft = await lontar.fetch(
      new Request('http://localhost/api/posts?draft=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Draft Post' }),
      }),
    )
    expect(resDraft.status).toBe(201)

    expect(beforeValidateHook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        statusTransition: 'draft',
        operation: 'create',
      }),
    )
    expect(beforeChangeHook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        statusTransition: 'draft',
        operation: 'create',
      }),
    )
    expect(afterChangeHook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        statusTransition: 'draft',
        operation: 'create',
      }),
    )
  })

  it('runs beforeValidate hook with statusTransition: "publish" when publishing a draft', async () => {
    const beforeValidateHook = vi.fn<BeforeValidateHook>(({ data, statusTransition }) => {
      if (statusTransition === 'publish') {
        return { ...data, slug: 'derived-slug' }
      }
      return data
    })

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      versions: { drafts: true },
      fields: {
        title: f.text({ required: true }),
        slug: f.text(),
      },
      hooks: {
        beforeValidate: [beforeValidateHook],
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

    // Create draft
    const createRes = await lontar.fetch(
      new Request('http://localhost/api/posts?draft=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Draft Post' }),
      }),
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: number }

    beforeValidateHook.mockClear()

    // Publish document
    const pubRes = await lontar.fetch(
      new Request(`http://localhost/api/posts/${created.id}/publish`, {
        method: 'POST',
      }),
    )
    expect(pubRes.status).toBe(200)

    expect(beforeValidateHook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'published',
        statusTransition: 'publish',
        operation: 'update',
      }),
    )

    const publishedDoc = (await pubRes.json()) as { id: number; slug: string; _status: string }
    expect(publishedDoc._status).toBe('published')
    expect(publishedDoc.slug).toBe('derived-slug')
  })

  it('derives hook status from draft flag and strips client-sent _status', async () => {
    const beforeValidateHook = vi.fn(({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      slug: 'hook-slug',
    }))
    const beforeChangeHook = vi.fn(({ data }: { data: Record<string, unknown> }) => data)

    const postsCol = collection({
      slug: 'posts',
      access: publicAccess,
      versions: { drafts: true },
      fields: {
        title: f.text({ required: true }),
        slug: f.text(),
      },
      hooks: {
        beforeValidate: [beforeValidateHook],
        beforeChange: [beforeChangeHook],
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

    // 1. Client sends _status: 'published' on create draft POST
    const createRes = await lontar.fetch(
      new Request('http://localhost/api/posts?draft=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Draft Post', _status: 'published' }),
      }),
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: number; _status: string }
    expect(created._status).toBe('draft')

    // beforeValidate saw status: 'draft', statusTransition: 'draft', and data._status was stripped
    const createHookCall = beforeValidateHook.mock.calls[0]?.[0] as {
      status?: string
      statusTransition?: string
      operation?: string
      data?: Record<string, unknown>
    }
    expect(createHookCall.status).toBe('draft')
    expect(createHookCall.statusTransition).toBe('draft')
    expect(createHookCall.operation).toBe('create')
    expect(createHookCall.data?._status).toBeUndefined()

    beforeValidateHook.mockClear()
    beforeChangeHook.mockClear()

    // 2. Client sends _status: 'published' on update PATCH ?draft=true
    const updateRes = await lontar.fetch(
      new Request(`http://localhost/api/posts/${created.id}?draft=true`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Draft', _status: 'published' }),
      }),
    )
    expect(updateRes.status).toBe(200)

    const updateHookCall = beforeValidateHook.mock.calls[0]?.[0] as {
      status?: string
      statusTransition?: string
      operation?: string
      data?: Record<string, unknown>
    }
    expect(updateHookCall.status).toBe('draft')
    expect(updateHookCall.statusTransition).toBe('draft')
    expect(updateHookCall.operation).toBe('update')
    expect(updateHookCall.data?._status).toBeUndefined()
  })
})
