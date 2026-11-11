import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { fields as f } from '../../fields'
import { defineConfig } from '../../config/define-config'
import type { CollectionConfig } from '../../config/types'
import type {
  DatabaseAdapter,
  DocumentData,
  FindVersionsArgs,
  PaginatedVersions,
  SaveVersionArgs,
  StoredDoc,
  StoredVersion,
} from '../../database/adapter'
import type { StorageAdapter, UploadFile, UploadResult } from '../../storage/adapter'
import { registerCollectionRoutes } from './collection'
import { updateOperation } from '../../operations/update'

const publicAccess = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
}

function matchesEqualsFilter(doc: StoredDoc, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  for (const [key, filter] of Object.entries(where as Record<string, unknown>)) {
    if (filter && typeof filter === 'object' && 'equals' in filter) {
      if (doc[key] !== filter.equals) return false
    }
  }
  return true
}

function createMockDb(
  initialDocs: Record<string, Array<DocumentData & { id?: number }>> = {},
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

  let nextId = 100
  const versionsStore: StoredVersion[] = []

  return {
    name: 'mock',
    find: ({ collection, where: _where, sort: _sort, page = 1, limit = 10 }) => {
      const all = (store.get(collection.slug) ?? []).filter((d) => matchesEqualsFilter(d, _where))
      const start = (page - 1) * limit
      const docs = all.slice(start, start + limit)
      return Promise.resolve({
        docs,
        totalDocs: all.length,
        limit,
        totalPages: Math.ceil(all.length / limit) || 1,
        page,
        hasPrevPage: page > 1,
        hasNextPage: start + limit < all.length,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: start + limit < all.length ? page + 1 : null,
      })
    },
    findByID: ({ collection, id }) => {
      const all = store.get(collection.slug) ?? []
      const doc = all.find((d) => d.id === id) ?? null
      return Promise.resolve(doc)
    },
    create: ({ collection, data }) => {
      const id = ++nextId
      const all = store.get(collection.slug) ?? []
      const doc: StoredDoc = {
        id,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...data,
      }
      all.push(doc)
      store.set(collection.slug, all)
      return Promise.resolve(doc)
    },
    update: ({ collection, id, data }) => {
      const all = store.get(collection.slug) ?? []
      const idx = all.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const existing = all[idx]!
      const updated: StoredDoc = {
        ...existing,
        ...data,
        updatedAt: '2026-11-01T00:00:00.000Z',
      }
      for (const [k, v] of Object.entries(data)) {
        if (v === null) {
          delete (updated as Record<string, unknown>)[k]
        }
      }
      all[idx] = updated
      return Promise.resolve(updated)
    },
    delete: ({ collection, id }) => {
      const all = store.get(collection.slug) ?? []
      const idx = all.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const [removed] = all.splice(idx, 1)
      return Promise.resolve(removed ?? null)
    },
    saveVersion: (args: SaveVersionArgs) => {
      const parentId = args.parentId ?? 1
      const docVersions = versionsStore.filter((v) => v.parentId === parentId)
      const maxVer = docVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0)
      if (args.autosave) {
        const latest = docVersions[docVersions.length - 1]
        if (latest && latest._status === 'draft' && latest.autosave) {
          latest.snapshot = args.snapshot
          latest.createdBy = args.userId ?? null
          return Promise.resolve({ ...latest })
        }
      }
      const newVersion: StoredVersion = {
        id: versionsStore.length + 1,
        parentId,
        versionNumber: maxVer + 1,
        snapshot: args.snapshot,
        _status: args.status,
        autosave: Boolean(args.autosave),
        createdAt: '2026-11-01T00:00:00.000Z',
        createdBy: args.userId ?? null,
      }
      versionsStore.push(newVersion)
      return Promise.resolve({ ...newVersion })
    },
    findVersions: (args: FindVersionsArgs) => {
      const docVersions = versionsStore
        .filter((v) => v.parentId === args.parentId)
        .sort((a, b) => b.id - a.id)
      return Promise.resolve<PaginatedVersions>({
        docs: docVersions,
        totalDocs: docVersions.length,
        limit: args.limit ?? 10,
        page: args.page ?? 1,
        totalPages: Math.ceil(docVersions.length / (args.limit ?? 10)) || 1,
      })
    },
    findVersionByID: (args: { parentId: number; versionId: number }) => {
      const found = versionsStore.find(
        (v) => v.parentId === args.parentId && v.id === args.versionId,
      )
      return Promise.resolve(found ? { ...found } : null)
    },
    findLatestDraftVersion: (args: { parentId: number }) => {
      const docVersions = versionsStore
        .filter((v) => v.parentId === args.parentId)
        .sort((a, b) => b.id - a.id)
      const latest = docVersions[0]
      if (latest && latest._status === 'draft') {
        return Promise.resolve({ ...latest })
      }
      return Promise.resolve(null)
    },
    hasVersionWithFilename: (args: { collection: CollectionConfig; filename: string }) => {
      const exists = versionsStore.some(
        (v) => (v.snapshot as { filename?: string }).filename === args.filename,
      )
      return Promise.resolve(exists)
    },
    findGlobal: () => Promise.resolve(null),
    updateGlobal: () =>
      Promise.resolve({
        id: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      }),
    toSchemaFile: () => '',
    migrate: () => Promise.resolve(),
  }
}

function createMockStorage(initialFiles?: Record<string, Buffer>) {
  const uploaded: UploadFile[] = []
  const deleted: string[] = []
  const files = new Map<string, Buffer>(Object.entries(initialFiles ?? {}))

  const storage: StorageAdapter = {
    name: 'mock',
    upload: (file: UploadFile): Promise<UploadResult> => {
      uploaded.push(file)
      files.set(file.filename, file.buffer)
      return Promise.resolve({
        filename: file.filename,
        url: `/media/${file.filename}`,
      })
    },
    delete: (filename: string): Promise<void> => {
      deleted.push(filename)
      files.delete(filename)
      return Promise.resolve()
    },
    getUrl: (filename: string) => `/media/${filename}`,
    read: (filename: string): Promise<Buffer | null> => {
      return Promise.resolve(files.get(filename) ?? null)
    },
  }

  return { storage, uploaded, deleted, files }
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const TINY_PNG_2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wn4GBgYGBgQEABwUBAQn8gVAAAAAASUVORK5CYII=',
  'base64',
)

describe('collection upload routes', () => {
  it('creates media document via multipart/form-data with image sizes', async () => {
    const { storage, uploaded } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: {
            sizes: {
              thumb: { width: 10, height: 10 },
            },
          },
          fields: {
            alt: f.text({ required: true }),
          },
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], 'pixel.png', { type: 'image/png' })
    formData.append('file', file)
    formData.append('alt', 'A single transparent pixel')

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(201)
    const json = (await res.json()) as DocumentData
    expect(json.filename).toBe('pixel.png')
    expect(json.url).toBe('/media/pixel.png')
    expect(json.mimeType).toBe('image/png')
    expect(json.alt).toBe('A single transparent pixel')
    expect(json.width).toBe(1)
    expect(json.height).toBe(1)
    expect(json.sizes).toBeDefined()
    expect(uploaded.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects POST /api/media without a file', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {
            alt: f.text({ required: true }),
          },
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    formData.append('alt', 'Missing file')

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('No file provided in upload request')
  })

  it('rejects POST /api/media with disallowed mimeType', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: {
            mimeTypes: ['image/jpeg'],
          },
          fields: {
            alt: f.text({ required: true }),
          },
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], 'pixel.png', { type: 'image/png' })
    formData.append('file', file)
    formData.append('alt', 'PNG instead of JPEG')

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('not allowed')
  })

  it('replaces file in storage and updates metadata on PATCH /api/media/:id', async () => {
    const { storage, deleted } = createMockStorage()
    const db = createMockDb({
      media: [
        {
          id: 1,
          filename: 'old.png',
          url: '/media/old.png',
          mimeType: 'image/png',
          filesize: 100,
          alt: 'Old image',
        },
      ],
    })

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {
            alt: f.text(),
          },
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const newFile = new File([TINY_PNG], 'new.png', { type: 'image/png' })
    formData.append('file', newFile)
    formData.append('alt', 'Updated image')

    const res = await app.request('/media/1', {
      method: 'PATCH',
      body: formData,
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as DocumentData
    expect(json.filename).toBe('new.png')
    expect(json.alt).toBe('Updated image')
    expect(deleted).toContain('old.png')
  })

  it('cleans up storage when DELETE /api/media/:id is called', async () => {
    const { storage, deleted } = createMockStorage()
    const db = createMockDb({
      media: [
        {
          id: 1,
          filename: 'delete-me.png',
          url: '/media/delete-me.png',
          mimeType: 'image/png',
          filesize: 100,
          sizes: {
            thumb: { filename: 'delete-me-thumb.png' },
          },
        },
      ],
    })

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const res = await app.request('/media/1', {
      method: 'DELETE',
    })

    expect(res.status).toBe(200)
    expect(deleted).toContain('delete-me.png')
    expect(deleted).toContain('delete-me-thumb.png')
  })

  it('populates upload field via depth parameter', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb({
      media: [
        {
          id: 42,
          filename: 'hero.png',
          url: '/media/hero.png',
          mimeType: 'image/png',
          filesize: 1024,
          width: 800,
          height: 600,
        },
      ],
      articles: [
        {
          id: 1,
          title: 'Hello World',
          cover: 42,
        },
      ],
    })

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
        {
          slug: 'articles',
          access: publicAccess,
          fields: {
            title: f.text({ required: true }),
            cover: f.upload({ relationTo: 'media', required: true }),
          },
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const res = await app.request('/articles/1?depth=1')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { cover: { id: number; filename: string; url: string } }
    expect(typeof json.cover).toBe('object')
    expect(json.cover.id).toBe(42)
    expect(json.cover.filename).toBe('hero.png')
    expect(json.cover.url).toBe('/media/hero.png')
  })

  it('sanitizes traversal filename on POST /api/media', async () => {
    const { storage, uploaded } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], '../escaped.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(201)
    const json = (await res.json()) as DocumentData
    expect(json.filename).toBe('escaped.png')
    const uploadedFilenames = uploaded.map((u) => u.filename)
    expect(uploadedFilenames).toContain('escaped.png')
    expect(uploadedFilenames.some((k) => k.includes('..'))).toBe(false)
  })

  it('generates unique filename when different document uploads same filename', async () => {
    const { storage, uploaded } = createMockStorage()
    const db = createMockDb({
      media: [
        {
          id: 1,
          filename: 'photo.png',
          url: '/media/photo.png',
          mimeType: 'image/png',
          filesize: 100,
        },
      ],
    })

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], 'photo.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(201)
    const json = (await res.json()) as DocumentData
    expect(json.filename).toBe('photo-1.png')
    expect(uploaded.map((u) => u.filename)).toContain('photo-1.png')
  })

  it('does not delete file when re-uploading same filename on PATCH /api/media/:id', async () => {
    const { storage, deleted } = createMockStorage()
    const db = createMockDb({
      media: [
        {
          id: 1,
          filename: 'photo.png',
          url: '/media/photo.png',
          mimeType: 'image/png',
          filesize: 100,
        },
      ],
    })

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], 'photo.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media/1', {
      method: 'PATCH',
      body: formData,
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as DocumentData
    expect(json.filename).toBe('photo.png')
    expect(deleted).not.toContain('photo.png')
  })

  it('rejects unauthenticated upload on POST /media with 401 without parsing body', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: {
            create: ({ user }) => Boolean(user),
          },
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], 'photo.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(401)
  })

  it('rejects unauthenticated upload on PATCH /media/:id with 401 without parsing body', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb({
      media: [{ id: 1, filename: 'photo.png', url: '/media/photo.png', mimeType: 'image/png' }],
    })

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: {
            update: ({ user }) => Boolean(user),
          },
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], 'photo.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media/1', {
      method: 'PATCH',
      body: formData,
    })

    expect(res.status).toBe(401)
  })

  it('enforces maxFileSize and returns 413 when file is too large', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: {
            maxFileSize: 50, // 50 bytes limit
          },
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const largeBuffer = Buffer.alloc(200, 1)
    const file = new File([largeBuffer], 'large.bin', { type: 'application/octet-stream' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(413)
  })

  it('rejects HTML disguised as image/png with 400', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: {
            mimeTypes: ['image/*'],
          },
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const fakeHtml = Buffer.from('<html><body><script>alert(1)</script></body></html>')
    const file = new File([fakeHtml], 'payload.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('Invalid image')
  })

  it('rejects HTML upload by default when mimeTypes is omitted', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const html = Buffer.from('<!DOCTYPE html><html><body>hello</body></html>')
    const file = new File([html], 'page.html', { type: 'text/html' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
  })

  it('rejects SVG with script tag even when image/svg+xml is allowed', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: {
            mimeTypes: ['image/svg+xml'],
          },
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const evilSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    )
    const file = new File([evilSvg], 'vector.svg', { type: 'image/svg+xml' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('executable scripts')
  })

  it('rejects SVG upload when wildcard image/* is configured without explicit image/svg+xml', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: {
            mimeTypes: ['image/*'],
          },
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')
    const file = new File([svg], 'circle.svg', { type: 'image/svg+xml' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
  })

  it('allows safe SVG upload when image/svg+xml is explicitly allowed', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: {
            mimeTypes: ['image/svg+xml'],
          },
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')
    const file = new File([svg], 'circle.svg', { type: 'image/svg+xml' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(201)
  })

  it('maps sharp decode error to 400 Invalid image', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    // Valid PNG header & IHDR chunk, but corrupted IDAT / payload so sharp decode fails
    const corruptPng = Buffer.from(TINY_PNG)
    corruptPng.write('corrupt data here!!!', 35)
    const file = new File([corruptPng], 'broken.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Invalid image')
  })

  it('normalizes filename extension based on sniffed magic bytes', async () => {
    const { storage } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    // TINY_PNG with .jpg extension provided by client
    const file = new File([TINY_PNG], 'image.jpg', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(201)
    const json = (await res.json()) as DocumentData
    expect(json.filename).toBe('image.png')
  })

  it('sets Content-Disposition: attachment on non-image uploads', async () => {
    const { storage, uploaded } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: {
            mimeTypes: ['application/pdf'],
          },
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    // PDF magic bytes %PDF-
    const pdfBuf = Buffer.from('%PDF-1.4 mock pdf document content')
    const file = new File([pdfBuf], 'contract.pdf', { type: 'application/pdf' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(201)
    expect(uploaded[0]?.contentDisposition).toBe('attachment; filename="contract.pdf"')
  })

  it('rolls back uploaded file and created row when afterChange throws on create', async () => {
    const { storage, deleted } = createMockStorage()
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
          hooks: {
            afterChange: [
              () => {
                throw new Error('afterChange failed')
              },
            ],
          },
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], 'pixel.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(500)
    // Uploaded file should have been deleted from storage
    expect(deleted).toContain('pixel.png')
    // Database should have 0 docs
    const listRes = await db.find({ collection: config.collections[0]!, limit: 10, page: 1 })
    expect(listRes.totalDocs).toBe(0)
  })

  it('rolls back newly uploaded file and restores original doc when afterChange throws on update', async () => {
    const { storage, deleted } = createMockStorage()
    const db = createMockDb({
      media: [
        {
          id: 1,
          filename: 'original.png',
          mimeType: 'image/png',
          filesize: 100,
        },
      ],
    })

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {
            alt: f.text(),
          },
          hooks: {
            afterChange: [
              () => {
                throw new Error('afterChange failed on update')
              },
            ],
          },
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const newFile = new File([TINY_PNG], 'replaced.png', { type: 'image/png' })
    formData.append('file', newFile)
    formData.append('alt', 'New Alt Text')

    const res = await app.request('/media/1', {
      method: 'PATCH',
      body: formData,
    })

    expect(res.status).toBe(500)
    // Newly uploaded file was rolled back
    expect(deleted).toContain('replaced.png')
    // Original file was NOT deleted
    expect(deleted).not.toContain('original.png')
    // Original doc is preserved in DB
    const doc = await db.findByID({ collection: config.collections[0]!, id: 1 })
    expect(doc?.filename).toBe('original.png')
    expect(doc?.alt).toBeUndefined()
  })

  it('returns 500 when storage upload fails', async () => {
    const failingStorage: StorageAdapter = {
      name: 'failing',
      upload: () => Promise.reject(new Error('Disk full')),
      delete: () => Promise.resolve(),
      getUrl: (f) => `https://example.com/${f}`,
    }
    const db = createMockDb()

    const config = defineConfig({
      secret: 'test-secret',
      db,
      storage: failingStorage,
      collections: [
        {
          slug: 'media',
          access: publicAccess,
          upload: true,
          fields: {},
        },
      ],
    })

    const app = new Hono()
    registerCollectionRoutes(app as never, config)

    const formData = new FormData()
    const file = new File([TINY_PNG], 'pixel.png', { type: 'image/png' })
    formData.append('file', file)

    const res = await app.request('/media', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Upload failed')
  })

  describe('GET /:collection/file/:filename', () => {
    it('serves image files with inline Content-Disposition and image mime type', async () => {
      const { storage } = createMockStorage({
        'pixel.png': TINY_PNG,
      })
      const db = createMockDb()
      const config = defineConfig({
        secret: 'test-secret',
        db,
        storage,
        collections: [
          {
            slug: 'media',
            access: publicAccess,
            upload: true,
            fields: {},
          },
        ],
      })
      const app = new Hono()
      registerCollectionRoutes(app as never, config)

      const res = await app.request('/media/file/pixel.png')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(res.headers.get('content-disposition')).toBe('inline')
      expect(res.headers.get('cache-control')).toContain('immutable')
      const bytes = Buffer.from(await res.arrayBuffer())
      expect(bytes.equals(TINY_PNG)).toBe(true)
    })

    it('serves non-image files with attachment Content-Disposition', async () => {
      const pdfBytes = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')
      const { storage } = createMockStorage({
        'document.pdf': pdfBytes,
      })
      const db = createMockDb()
      const config = defineConfig({
        secret: 'test-secret',
        db,
        storage,
        collections: [
          {
            slug: 'media',
            access: publicAccess,
            upload: true,
            fields: {},
          },
        ],
      })
      const app = new Hono()
      registerCollectionRoutes(app as never, config)

      const res = await app.request('/media/file/document.pdf')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/pdf')
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="document.pdf"')
    })

    it('returns 404 when file does not exist in storage', async () => {
      const { storage } = createMockStorage()
      const db = createMockDb()
      const config = defineConfig({
        secret: 'test-secret',
        db,
        storage,
        collections: [
          {
            slug: 'media',
            access: publicAccess,
            upload: true,
            fields: {},
          },
        ],
      })
      const app = new Hono()
      registerCollectionRoutes(app as never, config)

      const res = await app.request('/media/file/non-existent.png')
      expect(res.status).toBe(404)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('File not found')
    })

    it('returns 404 when collection is not an upload collection', async () => {
      const { storage } = createMockStorage({ 'file.png': TINY_PNG })
      const db = createMockDb()
      const config = defineConfig({
        secret: 'test-secret',
        db,
        storage,
        collections: [
          {
            slug: 'posts',
            access: publicAccess,
            fields: {},
          },
        ],
      })
      const app = new Hono()
      registerCollectionRoutes(app as never, config)

      const res = await app.request('/posts/file/file.png')
      expect(res.status).toBe(404)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('Collection does not support uploads')
    })

    it('returns 404 when storage adapter does not implement read', async () => {
      const storageWithoutRead: StorageAdapter = {
        name: 'no-read',
        upload: (f) => Promise.resolve({ filename: f.filename, url: `/media/${f.filename}` }),
        delete: () => Promise.resolve(),
        getUrl: (f) => `/media/${f}`,
      }
      const db = createMockDb()
      const config = defineConfig({
        secret: 'test-secret',
        db,
        storage: storageWithoutRead,
        collections: [
          {
            slug: 'media',
            access: publicAccess,
            upload: true,
            fields: {},
          },
        ],
      })
      const app = new Hono()
      registerCollectionRoutes(app as never, config)

      const res = await app.request('/media/file/file.png')
      expect(res.status).toBe(404)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('File serving is not supported by current storage adapter')
    })

    it('enforces read access control', async () => {
      const { storage } = createMockStorage({ 'secret.png': TINY_PNG })
      const db = createMockDb()
      const config = defineConfig({
        secret: 'test-secret',
        db,
        storage,
        collections: [
          {
            slug: 'media',
            access: {
              ...publicAccess,
              read: () => false,
            },
            upload: true,
            fields: {},
          },
        ],
      })
      const app = new Hono()
      registerCollectionRoutes(app as never, config)

      const res = await app.request('/media/file/secret.png')
      expect(res.status).toBe(401)
    })

    it('rejects path traversal attempts', async () => {
      const { storage } = createMockStorage()
      const db = createMockDb()
      const config = defineConfig({
        secret: 'test-secret',
        db,
        storage,
        collections: [
          {
            slug: 'media',
            access: publicAccess,
            upload: true,
            fields: {},
          },
        ],
      })
      const app = new Hono()
      registerCollectionRoutes(app as never, config)

      const res = await app.request('/media/file/..%2F..%2Fetc%2Fpasswd')
      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('Invalid filename')
    })
  })

  describe('Drafts and versions on upload collections (#228)', () => {
    function setupVersionsUpload() {
      const { storage, deleted, files } = createMockStorage({
        'old.png': TINY_PNG,
      })
      const db = createMockDb({
        media: [
          {
            id: 1,
            filename: 'old.png',
            url: '/media/old.png',
            mimeType: 'image/png',
            filesize: 100,
            alt: 'Old image',
            _status: 'published',
          },
        ],
      })
      const config = defineConfig({
        secret: 'test-secret',
        db,
        storage,
        collections: [
          {
            slug: 'media',
            access: publicAccess,
            upload: true,
            versions: { drafts: true },
            fields: {
              alt: f.text(),
            },
          },
        ],
      })
      const app = new Hono()
      registerCollectionRoutes(app as never, config)
      return { app, storage, deleted, files, db, config }
    }

    it('keeps the published file readable when replacing a file as draft, and deletes it on publish', async () => {
      const { app, deleted, files } = setupVersionsUpload()

      const formData = new FormData()
      const newFile = new File([TINY_PNG], 'new.png', { type: 'image/png' })
      formData.append('file', newFile)
      formData.append('alt', 'Draft new image')

      const patchRes = await app.request('/media/1?draft=true', {
        method: 'PATCH',
        body: formData,
      })
      expect(patchRes.status).toBe(200)

      // The published file old.png must NOT be deleted while the update is a draft revision
      expect(deleted).not.toContain('old.png')
      expect(files.get('old.png')).toBeDefined()
      expect(files.get('new.png')).toBeDefined()

      // Public read returns the published document with old.png
      const liveRes = await app.request('/media/1')
      expect(liveRes.status).toBe(200)
      const liveJson = (await liveRes.json()) as DocumentData
      expect(liveJson.filename).toBe('old.png')
      expect(liveJson._status).toBe('published')

      // Serving the published file succeeds
      const fileRes = await app.request('/media/file/old.png')
      expect(fileRes.status).toBe(200)

      // Draft read returns new.png
      const draftRes = await app.request('/media/1?draft=true')
      expect(draftRes.status).toBe(200)
      const draftJson = (await draftRes.json()) as DocumentData
      expect(draftJson.filename).toBe('new.png')
      expect(draftJson._status).toBe('draft')

      // Publishing the draft updates the live row and removes the replaced old file
      const publishRes = await app.request('/media/1/publish', {
        method: 'POST',
      })
      expect(publishRes.status).toBe(200)
      expect(deleted).toContain('old.png')
      expect(files.get('old.png')).toBeUndefined()
      expect(files.get('new.png')).toBeDefined()

      // Live read now returns new.png
      const publishedRes = await app.request('/media/1')
      expect(publishedRes.status).toBe(200)
      const publishedJson = (await publishedRes.json()) as DocumentData
      expect(publishedJson.filename).toBe('new.png')
      expect(publishedJson._status).toBe('published')
    })

    it('resolves latest draft as originalDoc on consecutive draft file replacements', async () => {
      const { app, deleted, files } = setupVersionsUpload()

      // First draft update with draft1.png
      const form1 = new FormData()
      form1.append('file', new File([TINY_PNG], 'draft1.png', { type: 'image/png' }))
      form1.append('alt', 'Draft 1')
      const res1 = await app.request('/media/1?draft=true', {
        method: 'PATCH',
        body: form1,
      })
      expect(res1.status).toBe(200)
      expect(deleted).not.toContain('old.png')

      // Second draft update with draft2.png
      const form2 = new FormData()
      form2.append('file', new File([TINY_PNG], 'draft2.png', { type: 'image/png' }))
      form2.append('alt', 'Draft 2')
      const res2 = await app.request('/media/1?draft=true', {
        method: 'PATCH',
        body: form2,
      })
      expect(res2.status).toBe(200)
      expect(deleted).not.toContain('old.png')

      // Draft read sees draft2.png
      const draftRes = await app.request('/media/1?draft=true')
      const draftJson = (await draftRes.json()) as DocumentData
      expect(draftJson.filename).toBe('draft2.png')

      // Live read still sees old.png
      const liveRes = await app.request('/media/1')
      const liveJson = (await liveRes.json()) as DocumentData
      expect(liveJson.filename).toBe('old.png')

      // Publishing removes old.png
      await app.request('/media/1/publish', { method: 'POST' })
      expect(deleted).toContain('old.png')
      expect(files.get('old.png')).toBeUndefined()
    })

    it('treats autosave on an upload collection as draft without deleting the live file', async () => {
      const { app, deleted, files } = setupVersionsUpload()

      const formData = new FormData()
      formData.append('file', new File([TINY_PNG], 'autosaved.png', { type: 'image/png' }))
      formData.append('alt', 'Autosaved')

      const res = await app.request('/media/1?autosave=true', {
        method: 'PATCH',
        body: formData,
      })
      expect(res.status).toBe(200)

      // Live published file must not be deleted
      expect(deleted).not.toContain('old.png')
      expect(files.get('old.png')).toBeDefined()

      // Live document remains published
      const liveRes = await app.request('/media/1')
      const liveJson = (await liveRes.json()) as DocumentData
      expect(liveJson.filename).toBe('old.png')
      expect(liveJson._status).toBe('published')
    })

    it('draft upload with the same filename as the published file leaves the published file bytes unchanged', async () => {
      const { app, files } = setupVersionsUpload()
      const originalBytes = files.get('old.png')!
      expect(originalBytes).toBeDefined()

      // Draft upload uses the SAME filename "old.png", but with different bytes (TINY_PNG_2)
      const formData = new FormData()
      formData.append('file', new File([TINY_PNG_2], 'old.png', { type: 'image/png' }))
      formData.append('alt', 'Draft update with same filename')

      const patchRes = await app.request('/media/1?draft=true', {
        method: 'PATCH',
        body: formData,
      })
      expect(patchRes.status).toBe(200)
      const patchJson = (await patchRes.json()) as DocumentData
      // Draft upload should receive a disambiguated filename so it does not collide with the live file
      expect(patchJson.filename).toBe('old-1.png')

      // The published file old.png bytes MUST remain completely unchanged!
      expect(files.get('old.png')).toEqual(originalBytes)
      // The new draft file must have the new bytes
      expect(files.get('old-1.png')).toEqual(TINY_PNG_2)
    })

    it("a second document cannot take a filename held only by another document's draft", async () => {
      const { app, files } = setupVersionsUpload()

      // Doc #1 creates a draft upload named 'custom-draft.png'
      const form1 = new FormData()
      form1.append('file', new File([TINY_PNG], 'custom-draft.png', { type: 'image/png' }))
      form1.append('alt', 'Doc 1 draft image')

      const res1 = await app.request('/media/1?draft=true', {
        method: 'PATCH',
        body: form1,
      })
      expect(res1.status).toBe(200)
      const json1 = (await res1.json()) as DocumentData
      expect(json1.filename).toBe('custom-draft.png')
      expect(files.get('custom-draft.png')).toEqual(TINY_PNG)

      // The parent table still has 'old.png' for doc 1, not 'custom-draft.png'
      const doc1Live = await app.request('/media/1')
      const doc1LiveJson = (await doc1Live.json()) as DocumentData
      expect(doc1LiveJson.filename).toBe('old.png')

      // Now create doc #2 with a file also named 'custom-draft.png'
      const form2 = new FormData()
      form2.append('file', new File([TINY_PNG_2], 'custom-draft.png', { type: 'image/png' }))
      form2.append('alt', 'Doc 2 image')

      const res2 = await app.request('/media', {
        method: 'POST',
        body: form2,
      })
      expect(res2.status).toBe(201)
      const json2 = (await res2.json()) as DocumentData
      // Doc 2 must NOT overwrite doc 1's draft file 'custom-draft.png'
      expect(json2.filename).toBe('custom-draft-1.png')
      expect(files.get('custom-draft.png')).toEqual(TINY_PNG)
      expect(files.get('custom-draft-1.png')).toEqual(TINY_PNG_2)
    })

    it('partial draft update after unpublish does not delete pending draft file and preserves draft upload fields', async () => {
      const { app, deleted, files } = setupVersionsUpload()

      // 1. Initial live upload has 'old.png' with alt 'Old image'
      // 2. Draft update replaces file with 'draft.png' and alt 'Draft image'
      const form = new FormData()
      form.append('file', new File([TINY_PNG_2], 'draft.png', { type: 'image/png' }))
      form.append('alt', 'Draft image')

      const patchRes = await app.request('/media/1?draft=true', {
        method: 'PATCH',
        body: form,
      })
      expect(patchRes.status).toBe(200)
      expect(files.get('draft.png')).toBeDefined()
      expect(files.get('old.png')).toBeDefined()

      // 3. Unpublish document
      const unpublishRes = await app.request('/media/1/unpublish', { method: 'POST' })
      expect(unpublishRes.status).toBe(200)

      // 4. Partial draft update updating only alt (no new file uploaded)
      const partialForm = new FormData()
      partialForm.append('alt', 'Updated Draft Alt')

      const partialRes = await app.request('/media/1?draft=true', {
        method: 'PATCH',
        body: partialForm,
      })
      expect(partialRes.status).toBe(200)

      // draft.png MUST NOT have been deleted
      expect(deleted).not.toContain('draft.png')
      expect(files.get('draft.png')).toBeDefined()
      expect(files.get('old.png')).toBeDefined()

      // 5. Draft read returns draft.png and updated alt
      const draftRes = await app.request('/media/1?draft=true')
      expect(draftRes.status).toBe(200)
      const draftJson = (await draftRes.json()) as DocumentData
      expect(draftJson.filename).toBe('draft.png')
      expect(draftJson.alt).toBe('Updated Draft Alt')
      expect(draftJson._status).toBe('draft')
    })

    it('local API updateOperation on upload after unpublish preserves draft media and does not delete it', async () => {
      const { app, deleted, files, config } = setupVersionsUpload()

      // 1. Draft update with 'draft.png'
      const form = new FormData()
      form.append('file', new File([TINY_PNG_2], 'draft.png', { type: 'image/png' }))
      form.append('alt', 'Draft image')

      const patchRes = await app.request('/media/1?draft=true', {
        method: 'PATCH',
        body: form,
      })
      expect(patchRes.status).toBe(200)

      // 2. Unpublish document
      const unpublishRes = await app.request('/media/1/unpublish', { method: 'POST' })
      expect(unpublishRes.status).toBe(200)

      // 3. Local API partial update with draft: true
      const mediaCol = config.collections[0]!
      const updated = await updateOperation({
        config,
        collection: mediaCol,
        id: 1,
        draft: true,
        data: { alt: 'Local API Alt' },
      })

      expect(deleted).not.toContain('draft.png')
      expect(files.get('draft.png')).toBeDefined()
      expect(files.get('old.png')).toBeDefined()
      expect(updated.filename).toBe('draft.png')
      expect(updated.alt).toBe('Local API Alt')
      expect(updated._status).toBe('draft')
    })
  })
})
