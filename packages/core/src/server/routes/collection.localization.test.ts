import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { CollectionConfig } from '../../config/types'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import { getLontar } from '../../local'
import { createLontar } from '../create-lontar'

interface MockAdapterContext {
  adapter: DatabaseAdapter
  mockFind: ReturnType<typeof vi.fn>
  mockFindByID: ReturnType<typeof vi.fn>
  mockCreate: ReturnType<typeof vi.fn>
  mockUpdate: ReturnType<typeof vi.fn>
  mockDelete: ReturnType<typeof vi.fn>
  mockFindGlobal: ReturnType<typeof vi.fn>
  mockUpdateGlobal: ReturnType<typeof vi.fn>
}

function createMockAdapter(overrides?: Partial<DatabaseAdapter>): MockAdapterContext {
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
      title: data.title,
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
      ...data,
    } as StoredDoc)
  })
  const mockUpdate = vi
    .fn()
    .mockImplementation(({ id, data }: { id: number; data: Record<string, unknown> }) => {
      return Promise.resolve({
        id,
        title: data.title ?? 'Updated',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T01:00:00.000Z',
        ...data,
      } as StoredDoc)
    })
  const mockDelete = vi.fn().mockImplementation(({ id }: { id: number }) => {
    return Promise.resolve({
      id,
      title: 'Deleted',
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    } as StoredDoc)
  })
  const mockFindGlobal = vi.fn().mockResolvedValue({
    id: 1,
    siteName: 'My Site',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
  })
  const mockUpdateGlobal = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      return Promise.resolve({
        id: 1,
        siteName: data.siteName ?? 'Updated Site',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T01:00:00.000Z',
        ...data,
      } as StoredDoc)
    })

  const adapter: DatabaseAdapter = {
    name: 'mock',
    find: mockFind,
    findByID: mockFindByID,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
    findGlobal: mockFindGlobal,
    updateGlobal: mockUpdateGlobal,
    findVersions: vi.fn().mockResolvedValue({
      docs: [
        {
          id: 1,
          parentId: 1,
          versionNumber: 1,
          _status: 'published',
          autosave: false,
          createdBy: null,
          snapshot: { id: 1, title: 'Snapshot 1' },
          createdAt: '2026-10-31T00:00:00.000Z',
        },
      ],
      totalDocs: 1,
      limit: 10,
      page: 1,
      totalPages: 1,
    }),
    findVersionByID: vi.fn().mockResolvedValue({
      id: 1,
      parentId: 1,
      versionNumber: 1,
      _status: 'published',
      autosave: false,
      createdBy: null,
      snapshot: { id: 1, title: 'Snapshot 1' },
      createdAt: '2026-10-31T00:00:00.000Z',
    }),
    toSchemaFile(): string {
      return ''
    },
    migrate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }

  return {
    adapter,
    mockFind,
    mockFindByID,
    mockCreate,
    mockUpdate,
    mockDelete,
    mockFindGlobal,
    mockUpdateGlobal,
  }
}

describe('Localization in REST and Local API (#424)', () => {
  it('REST: GET /:collection defaults omitted locale to defaultLocale', async () => {
    const { adapter, mockFind } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: { read: () => true, create: () => true, update: () => true, delete: () => true },
      fields: {
        title: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const res = await app.request('/api/posts')

    expect(res.status).toBe(200)
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'en',
      }),
    )
  })

  it('REST: GET /:collection passes ?locale=id and ?fallbackLocale=false', async () => {
    const { adapter, mockFind } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: { read: () => true },
      fields: {
        title: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const res = await app.request('/api/posts?locale=id&fallbackLocale=false')

    expect(res.status).toBe(200)
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'id',
        fallbackLocale: false,
      }),
    )
  })

  it('REST: GET /:collection?locale=all passes locale=all', async () => {
    const { adapter, mockFind } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: { read: () => true },
      fields: {
        title: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const res = await app.request('/api/posts?locale=all')

    expect(res.status).toBe(200)
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'all',
      }),
    )
  })

  it('REST: returns HTTP 400 with ADR 0012 validation error shape for unknown locale', async () => {
    const { adapter } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const res = await app.request('/api/posts?locale=invalid')

    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: string
      message: string
      issues: Array<{ path: string; message: string }>
    }
    expect(body.error).toBe('Validation failed')
    expect(body.message).toContain('Unknown locale "invalid"')
    expect(body.issues[0]?.path).toBe('locale')
    expect(body.issues[0]?.message).toContain('Unknown locale "invalid"')
  })

  it('REST: POST /:collection with ?locale=id validates single-locale payload without requiring other locales', async () => {
    const { adapter, mockCreate } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: { read: () => true, create: () => true, update: () => true, delete: () => true },
      fields: {
        title: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const res = await app.request('/api/posts?locale=id', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Judul Baru' }),
    })

    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'id',
      }),
    )
    const callArgs = mockCreate.mock.calls[0]?.[0] as { data: { title: string } }
    expect(callArgs.data.title).toBe('Judul Baru')
  })

  it('REST: POST /:collection with ?locale=all accepts multi-locale dictionary', async () => {
    const { adapter, mockCreate } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: { read: () => true, create: () => true, update: () => true, delete: () => true },
      fields: {
        title: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const res = await app.request('/api/posts?locale=all', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: { en: 'Hello', id: 'Halo' } }),
    })

    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'all',
      }),
    )
    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      data: { title: { en: string; id: string } }
    }
    expect(callArgs.data.title).toEqual({ en: 'Hello', id: 'Halo' })
  })

  it('REST: globals support ?locale= and reject unknown locale with 400', async () => {
    const { adapter, mockFindGlobal } = createMockAdapter()
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [],
      globals: [
        {
          slug: 'header',
          access: { read: () => true, update: () => true },
          fields: {
            siteName: f.text({ required: true, localized: true }),
          },
        },
      ],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)

    const validRes = await app.request('/api/globals/header?locale=id')
    expect(validRes.status).toBe(200)
    expect(mockFindGlobal).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'id',
      }),
    )

    const invalidRes = await app.request('/api/globals/header?locale=bad')
    expect(invalidRes.status).toBe(400)
    const body = (await invalidRes.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('REST: users route rejects invalid locale with HTTP 400', async () => {
    const { adapter } = createMockAdapter()
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const res = await app.request('/api/_lontar/users?locale=invalid')

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; issues: unknown[] }
    expect(body.error).toBe('Validation failed')
    expect(body.issues).toHaveLength(1)
  })

  it('Local API: options forward locale and fallbackLocale across operations', async () => {
    const { adapter, mockFind, mockFindByID, mockCreate, mockUpdate, mockDelete, mockFindGlobal } =
      createMockAdapter()
    const posts = collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      globals: [
        {
          slug: 'header',
          fields: {
            siteName: f.text({ required: true, localized: true }),
          },
        },
      ],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })

    const client = await getLontar(config)

    await client.find('posts', { locale: 'id', fallbackLocale: false })
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'id', fallbackLocale: false }),
    )

    await client.findByID('posts', 1, { locale: 'id' })
    expect(mockFindByID).toHaveBeenCalledWith(expect.objectContaining({ id: 1, locale: 'id' }))

    await client.create('posts', { data: { title: 'Halo' }, locale: 'id' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'id',
      }),
    )

    await client.update('posts', 1, { data: { title: 'Halo 2' }, locale: 'id' })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        locale: 'id',
      }),
    )

    await client.delete('posts', 1, { locale: 'id' })
    expect(mockDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))

    await client.findGlobal('header', { locale: 'id' })
    expect(mockFindGlobal).toHaveBeenCalledWith(expect.objectContaining({ locale: 'id' }))
  })

  it('Update: hooks see the original doc in the requested locale, not the default one', async () => {
    const mockFindByID = vi.fn().mockImplementation(({ locale }: { locale?: string }) =>
      Promise.resolve({
        id: 1,
        title: locale === 'all' ? { en: 'News', id: 'Berita' } : 'News',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      }),
    )
    const { adapter } = createMockAdapter({ findByID: mockFindByID })
    const seen: unknown[] = []
    const posts = collection({
      slug: 'posts',
      hooks: {
        beforeChange: [
          ({ data, originalDoc }) => {
            seen.push(originalDoc?.title)
            return data
          },
        ],
      },
      fields: { title: f.text({ required: true, localized: true }) },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: { locales: ['en', 'id'], defaultLocale: 'en' },
    })

    const client = await getLontar(config)
    await client.update('posts', 1, { data: { title: 'Baru' }, locale: 'id' })

    expect(seen).toEqual(['Berita'])
  })

  it('Hooks: beforeValidate, beforeChange, afterChange, afterRead receive locale', async () => {
    const receivedLocales: Record<string, string | undefined> = {}

    const { adapter } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true, localized: true }),
      },
      hooks: {
        beforeValidate: [
          ({ data, locale }) => {
            receivedLocales.beforeValidate = locale
            return data
          },
        ],
        beforeChange: [
          ({ data, locale }) => {
            receivedLocales.beforeChange = locale
            return data
          },
        ],
        afterChange: [
          ({ doc, locale }) => {
            receivedLocales.afterChange = locale
            return doc
          },
        ],
        afterRead: [
          ({ doc, locale }) => {
            receivedLocales.afterRead = locale
            return doc
          },
        ],
        beforeDelete: [
          ({ locale }) => {
            receivedLocales.beforeDelete = locale
          },
        ],
        afterDelete: [
          ({ doc, locale }) => {
            receivedLocales.afterDelete = locale
            return doc
          },
        ],
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })

    const client = await getLontar(config)
    await client.create('posts', { data: { title: 'Post Baru' }, locale: 'id' })

    expect(receivedLocales.beforeValidate).toBe('id')
    expect(receivedLocales.beforeChange).toBe('id')
    expect(receivedLocales.afterChange).toBe('id')

    await client.findByID('posts', 1, { locale: 'id' })
    expect(receivedLocales.afterRead).toBe('id')

    await client.delete('posts', 1, { locale: 'id' })
    expect(receivedLocales.beforeDelete).toBe('id')
    expect(receivedLocales.afterDelete).toBe('id')
  })

  it('Access Control: args receives locale in collection and field access', async () => {
    let collectionAccessLocale: string | undefined
    let fieldAccessLocale: string | undefined

    const { adapter } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: {
        read: ({ locale }) => {
          collectionAccessLocale = locale
          return true
        },
      },
      fields: {
        title: f.text({
          required: true,
          localized: true,
          access: {
            read: ({ locale }) => {
              fieldAccessLocale = locale
              return true
            },
          },
        }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })

    const app = createLontar(config)
    await app.request('/api/posts/1?locale=id')

    expect(collectionAccessLocale).toBe('id')
    expect(fieldAccessLocale).toBe('id')
  })

  it('Field Access: under locale=all, denying read access strips the entire field dictionary', async () => {
    const { adapter } = createMockAdapter({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        title: { en: 'Hello', id: 'Halo' },
        secret: { en: 'Secret EN', id: 'Secret ID' },
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      }),
    })
    const posts = collection({
      slug: 'posts',
      access: { read: () => true },
      fields: {
        title: f.text({ required: true, localized: true }),
        secret: f.text({
          localized: true,
          access: {
            read: () => false,
          },
        }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })

    const app = createLontar(config)
    const res = await app.request('/api/posts/1?locale=all')

    expect(res.status).toBe(200)
    const data = (await res.json()) as Record<string, unknown>
    expect(data.title).toEqual({ en: 'Hello', id: 'Halo' })
    expect(data.secret).toBeUndefined()
  })

  it('Depth: passes locale down to populated relation documents', async () => {
    const categories = collection({
      slug: 'categories',
      access: { read: () => true },
      fields: {
        name: f.text({ required: true, localized: true }),
      },
    })
    const posts = collection({
      slug: 'posts',
      access: { read: () => true },
      fields: {
        title: f.text({ required: true, localized: true }),
        category: f.relationship({ relationTo: 'categories' }),
      },
    })

    const mockFind = vi
      .fn()
      .mockImplementation(
        ({ collection: col, locale }: { collection: CollectionConfig; locale?: string }) => {
          if (col.slug === 'categories') {
            return Promise.resolve({
              docs: [
                {
                  id: 10,
                  name: locale === 'id' ? 'Kategori Indo' : 'English Category',
                  createdAt: '2026-10-31T00:00:00.000Z',
                  updatedAt: '2026-10-31T00:00:00.000Z',
                },
              ],
              totalDocs: 1,
              limit: 10,
              page: 1,
              totalPages: 1,
            })
          }
          return Promise.resolve({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
        },
      )

    const { adapter } = createMockAdapter({
      findByID: vi
        .fn()
        .mockImplementation(({ collection: col }: { collection: CollectionConfig }) => {
          if (col.slug === 'posts') {
            return Promise.resolve({
              id: 1,
              title: 'Post 1',
              category: 10,
              createdAt: '2026-10-31T00:00:00.000Z',
              updatedAt: '2026-10-31T00:00:00.000Z',
            })
          }
          return Promise.resolve(null)
        }),
      find: mockFind,
    })

    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [categories, posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })

    const app = createLontar(config)
    const res = await app.request('/api/posts/1?locale=id&depth=1')

    expect(res.status).toBe(200)
    const data = (await res.json()) as { category: { id: number; name: string } }
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'id',
      }),
    )
    expect(data.category.name).toBe('Kategori Indo')
  })

  it('Where and Sort: accepts localized paths title_en and title_id', async () => {
    const { adapter } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: { read: () => true },
      fields: {
        title: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      collections: [posts],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })

    const app = createLontar(config)
    const resWhere = await app.request('/api/posts?where[title_id][equals]=halo')
    expect(resWhere.status).toBe(200)

    const resSort = await app.request('/api/posts?sort=-title_en')
    expect(resSort.status).toBe(200)
  })

  it('Upload: passes locale and handles localized metadata on media upload', async () => {
    const mockStorage = {
      upload: vi.fn().mockResolvedValue({
        filename: 'test.png',
        mimeType: 'image/png',
        filesize: 100,
        width: 10,
        height: 10,
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      getUrl: vi.fn().mockReturnValue('/media/test.png'),
    }
    const { adapter, mockCreate } = createMockAdapter()
    const media = collection({
      slug: 'media',
      access: { read: () => true, create: () => true, update: () => true, delete: () => true },
      upload: true,
      fields: {
        alt: f.text({ required: true, localized: true }),
      },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: adapter,
      storage: mockStorage as never,
      collections: [media],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })

    const app = createLontar(config)
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    const formData = new FormData()
    formData.append('file', new File([tinyPng], 'test.png', { type: 'image/png' }))
    formData.append('alt', 'Deskripsi Gambar')

    const res = await app.request('/api/media?locale=id', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'id',
      }),
    )
    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      data: { alt: string; filename: string }
    }
    expect(callArgs.data.alt).toBe('Deskripsi Gambar')
    expect(callArgs.data.filename).toBe('test.png')
  })
})
