import { describe, expect, it, vi } from 'vitest'
import { defineConfig } from '../../config/define-config'
import { global } from '../../config/global'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import type { AfterChangeHook, AfterReadHook, BeforeChangeHook } from '../../hooks'
import { createLontar } from '../create-lontar'

function createMockAdapter() {
  let storedGlobal: StoredDoc | null = null

  const mockFind = vi.fn().mockResolvedValue({
    docs: [],
    totalDocs: 0,
    limit: 10,
    page: 1,
    totalPages: 0,
  })
  const mockFindByID = vi.fn().mockResolvedValue(null)
  const mockCreate = vi.fn().mockResolvedValue(null)
  const mockUpdate = vi.fn().mockResolvedValue(null)
  const mockDelete = vi.fn().mockResolvedValue(null)
  const mockToSchemaFile = vi.fn().mockReturnValue('')
  const mockMigrate = vi.fn().mockResolvedValue(undefined)

  const mockFindGlobal = vi.fn().mockImplementation(() => {
    return Promise.resolve(storedGlobal)
  })

  const mockUpdateGlobal = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      storedGlobal = {
        id: 1,
        ...storedGlobal,
        ...data,
        createdAt: storedGlobal?.createdAt ?? '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T01:00:00.000Z',
      }
      return Promise.resolve(storedGlobal)
    })

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
    mockFindGlobal,
    mockUpdateGlobal,
    setStoredGlobal: (val: StoredDoc | null) => {
      storedGlobal = val
    },
  }
}

describe('Global REST Routes', () => {
  it('returns 404 for unknown global slug', async () => {
    const { db } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [],
        globals: [
          global({
            slug: 'header',
            fields: { siteTitle: f.text() },
          }),
        ],
      }),
    )

    const res = await lontar.fetch(new Request('http://localhost/api/globals/unknown'))
    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('not found')
  })

  it('GET returns empty document {} if global is not yet stored', async () => {
    const { db, mockFindGlobal } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [],
        globals: [
          global({
            slug: 'header',
            fields: { siteTitle: f.text() },
          }),
        ],
      }),
    )

    const res = await lontar.fetch(new Request('http://localhost/api/globals/header'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({})
    expect(mockFindGlobal).toHaveBeenCalledTimes(1)
  })

  it('GET returns stored document and runs afterRead hook', async () => {
    const { db, setStoredGlobal } = createMockAdapter()
    setStoredGlobal({
      id: 1,
      siteTitle: 'My Lontar Blog',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    })

    const afterReadHook = vi.fn<AfterReadHook>(({ doc }) => {
      return {
        ...doc,
        computed: 'transformed',
      }
    })

    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [],
        globals: [
          global({
            slug: 'header',
            fields: { siteTitle: f.text() },
            hooks: {
              afterRead: [afterReadHook],
            },
          }),
        ],
      }),
    )

    const res = await lontar.fetch(new Request('http://localhost/api/globals/header'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { siteTitle: string; computed: string }
    expect(json.siteTitle).toBe('My Lontar Blog')
    expect(json.computed).toBe('transformed')
    expect(afterReadHook).toHaveBeenCalledTimes(1)
  })

  it('POST /globals/:slug validates input, runs hooks and updates global', async () => {
    const { db, mockUpdateGlobal } = createMockAdapter()

    const beforeChangeHook = vi.fn<BeforeChangeHook>(({ data, operation, originalDoc }) => {
      expect(operation).toBe('create')
      expect(originalDoc).toBeUndefined()
      return {
        ...data,
        tagline: 'Hook added tagline',
      }
    })

    const afterChangeHook = vi.fn<AfterChangeHook>(({ doc, operation }) => {
      expect(operation).toBe('create')
      return {
        ...doc,
        afterRan: true,
      }
    })

    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [],
        globals: [
          global({
            slug: 'header',
            fields: {
              siteTitle: f.text({ required: true }),
              tagline: f.text(),
            },
            hooks: {
              beforeChange: [beforeChangeHook],
              afterChange: [afterChangeHook],
            },
          }),
        ],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/globals/header', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteTitle: 'New Title' }),
      }),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { siteTitle: string; tagline: string; afterRan: boolean }
    expect(json.siteTitle).toBe('New Title')
    expect(json.tagline).toBe('Hook added tagline')
    expect(json.afterRan).toBe(true)
    expect(beforeChangeHook).toHaveBeenCalledTimes(1)
    expect(afterChangeHook).toHaveBeenCalledTimes(1)
    expect(mockUpdateGlobal).toHaveBeenCalledTimes(1)
  })

  it('enforces access control on read and update', async () => {
    const { db } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [],
        globals: [
          global({
            slug: 'header',
            fields: { siteTitle: f.text() },
            access: {
              read: ({ user }) => Boolean(user),
              update: ({ user }) => Boolean(user),
            },
          }),
        ],
      }),
    )

    const getRes = await lontar.fetch(new Request('http://localhost/api/globals/header'))
    expect(getRes.status).toBe(401)

    const postRes = await lontar.fetch(
      new Request('http://localhost/api/globals/header', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteTitle: 'Forbidden' }),
      }),
    )
    expect(postRes.status).toBe(401)
  })
})
