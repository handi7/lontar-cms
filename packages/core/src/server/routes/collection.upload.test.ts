import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { fields as f } from '../../fields'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter, DocumentData, StoredDoc } from '../../database/adapter'
import type { StorageAdapter, UploadFile, UploadResult } from '../../storage/adapter'
import { registerCollectionRoutes } from './collection'

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

function createMockStorage() {
  const uploaded: UploadFile[] = []
  const deleted: string[] = []

  const storage: StorageAdapter = {
    name: 'mock',
    upload: (file: UploadFile): Promise<UploadResult> => {
      uploaded.push(file)
      return Promise.resolve({
        filename: file.filename,
        url: `/media/${file.filename}`,
      })
    },
    delete: (filename: string): Promise<void> => {
      deleted.push(filename)
      return Promise.resolve()
    },
    getUrl: (filename: string) => `/media/${filename}`,
  }

  return { storage, uploaded, deleted }
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
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
})
