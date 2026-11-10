import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../auth/types'
import { defineConfig } from '../../config/define-config'
import { global } from '../../config/global'
import type {
  DatabaseAdapter,
  SaveVersionArgs,
  StoredDoc,
  StoredVersion,
} from '../../database/adapter'
import { fields as f } from '../../fields'
import type {
  AfterChangeHook,
  AfterReadHook,
  BeforeChangeHook,
  BeforeValidateHook,
} from '../../hooks'
import { getLontar } from '../../local'
import { createLontar } from '../create-lontar'

function createMockAdapter() {
  let storedGlobal: StoredDoc | null = null
  const storedVersions: StoredVersion[] = []

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

  const mockSaveVersion = vi.fn().mockImplementation((args: SaveVersionArgs) => {
    const nextNum = storedVersions.length + 1
    const version: StoredVersion = {
      id: nextNum,
      parentId: args.parentId ?? 1,
      versionNumber: nextNum,
      snapshot: args.snapshot,
      _status: args.status,
      autosave: Boolean(args.autosave),
      createdAt: '2026-11-01T02:00:00.000Z',
      createdBy: args.userId ?? null,
    }
    storedVersions.unshift(version)
    return Promise.resolve(version)
  })

  const mockFindVersions = vi.fn().mockImplementation(() => {
    return Promise.resolve({
      docs: storedVersions,
      totalDocs: storedVersions.length,
      limit: 10,
      page: 1,
      totalPages: 1,
    })
  })

  const mockFindVersionByID = vi.fn().mockImplementation(({ versionId }: { versionId: number }) => {
    const found = storedVersions.find((v) => v.id === versionId) ?? null
    return Promise.resolve(found)
  })

  // Like the MySQL adapter: the newest version, only while it is still a draft
  const mockFindLatestDraftVersion = vi.fn().mockImplementation(() => {
    const latest = storedVersions[0]
    return Promise.resolve(latest?._status === 'draft' ? latest : null)
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
    saveVersion: mockSaveVersion,
    findVersions: mockFindVersions,
    findVersionByID: mockFindVersionByID,
    findLatestDraftVersion: mockFindLatestDraftVersion,
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
    getStoredGlobal: () => storedGlobal,
    getVersions: () => storedVersions,
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
            access: { read: () => true, update: () => true },
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
            access: { read: () => true, update: () => true },
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
            access: { read: () => true, update: () => true },
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
            access: { read: () => true, update: () => true },
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

  it('requires authenticated user by default when access is not specified', async () => {
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

    const getRes = await lontar.fetch(new Request('http://localhost/api/globals/header'))
    expect(getRes.status).toBe(401)
    expect(await getRes.json()).toEqual({ error: 'Unauthorized' })

    const postRes = await lontar.fetch(
      new Request('http://localhost/api/globals/header', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteTitle: 'Blocked' }),
      }),
    )
    expect(postRes.status).toBe(401)
    expect(await postRes.json()).toEqual({ error: 'Unauthorized' })
  })

  it('runs beforeValidate hook on global update to normalize data before Zod validation', async () => {
    const beforeValidateHook: BeforeValidateHook = ({ data }) => {
      if (typeof data.siteTitle === 'string') {
        data.siteTitle = data.siteTitle.trim()
      }
      return data
    }

    const { db } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [],
        globals: [
          global({
            slug: 'header',
            access: { read: () => true, update: () => true },
            fields: { siteTitle: f.text({ required: true }) },
            hooks: {
              beforeValidate: [beforeValidateHook],
            },
          }),
        ],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/globals/header', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteTitle: '   Clean Site Title   ' }),
      }),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { siteTitle: string }
    expect(json.siteTitle).toBe('Clean Site Title')
  })

  it('supports drafts and version history endpoints for versioned global', async () => {
    const { db } = createMockAdapter()
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [],
        globals: [
          global({
            slug: 'settings',
            access: { read: () => true, update: () => true },
            versions: { drafts: true },
            fields: { siteTitle: f.text({ required: true }) },
          }),
        ],
      }),
    )

    // 1. Initial save as published
    const publishRes = await lontar.fetch(
      new Request('http://localhost/api/globals/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteTitle: 'Live Site Title' }),
      }),
    )
    expect(publishRes.status).toBe(200)
    const publishedDoc = (await publishRes.json()) as { siteTitle: string; _status: string }
    expect(publishedDoc.siteTitle).toBe('Live Site Title')
    expect(publishedDoc._status).toBe('published')

    // 2. Save a draft revision (does not overwrite published doc in database)
    const draftRes = await lontar.fetch(
      new Request('http://localhost/api/globals/settings?draft=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteTitle: 'Draft WIP Site Title' }),
      }),
    )
    expect(draftRes.status).toBe(200)
    const draftDoc = (await draftRes.json()) as { siteTitle: string; _status: string }
    expect(draftDoc.siteTitle).toBe('Draft WIP Site Title')
    expect(draftDoc._status).toBe('draft')

    // 3. GET /globals/settings returns published doc
    const getPublishedRes = await lontar.fetch(new Request('http://localhost/api/globals/settings'))
    expect(getPublishedRes.status).toBe(200)
    const getPublishedDoc = (await getPublishedRes.json()) as { siteTitle: string }
    expect(getPublishedDoc.siteTitle).toBe('Live Site Title')

    // 4. GET /globals/settings?draft=true returns latest draft
    const getDraftRes = await lontar.fetch(
      new Request('http://localhost/api/globals/settings?draft=true'),
    )
    expect(getDraftRes.status).toBe(200)
    const getDraftDoc = (await getDraftRes.json()) as { siteTitle: string }
    expect(getDraftDoc.siteTitle).toBe('Draft WIP Site Title')

    // 5. GET /globals/settings/versions returns versions list
    const versionsRes = await lontar.fetch(
      new Request('http://localhost/api/globals/settings/versions'),
    )
    expect(versionsRes.status).toBe(200)
    const versionsJson = (await versionsRes.json()) as {
      docs: Array<{ id: number; snapshot: { siteTitle: string } }>
    }
    expect(versionsJson.docs.length).toBeGreaterThanOrEqual(2)

    // 6. GET /globals/settings/versions/:versionId returns single version
    const version1Id = versionsJson.docs[versionsJson.docs.length - 1]!.id
    const singleVersionRes = await lontar.fetch(
      new Request(`http://localhost/api/globals/settings/versions/${version1Id}`),
    )
    expect(singleVersionRes.status).toBe(200)
    const singleVersionJson = (await singleVersionRes.json()) as {
      snapshot: { siteTitle: string }
    }
    expect(singleVersionJson.snapshot.siteTitle).toBe('Live Site Title')

    // 7. POST /globals/settings/publish publishes the latest draft
    const publishDraftRes = await lontar.fetch(
      new Request('http://localhost/api/globals/settings/publish', {
        method: 'POST',
      }),
    )
    expect(publishDraftRes.status).toBe(200)
    const publishedDraftDoc = (await publishDraftRes.json()) as {
      siteTitle: string
      _status: string
    }
    expect(publishedDraftDoc.siteTitle).toBe('Draft WIP Site Title')
    expect(publishedDraftDoc._status).toBe('published')

    // 8. POST /globals/settings/unpublish unpublishes
    const unpublishRes = await lontar.fetch(
      new Request('http://localhost/api/globals/settings/unpublish', {
        method: 'POST',
      }),
    )
    expect(unpublishRes.status).toBe(200)
    const unpublishedDoc = (await unpublishRes.json()) as { _status: string }
    expect(unpublishedDoc._status).toBe('draft')

    // 9. POST /globals/settings/versions/:versionId/restore restores an older version
    const restoreRes = await lontar.fetch(
      new Request(`http://localhost/api/globals/settings/versions/${version1Id}/restore`, {
        method: 'POST',
      }),
    )
    expect(restoreRes.status).toBe(200)
    const restoredDoc = (await restoreRes.json()) as { siteTitle: string }
    expect(restoredDoc.siteTitle).toBe('Live Site Title')
  })
})

describe('Draft revisions of a published global', () => {
  function setup() {
    const mock = createMockAdapter()
    mock.setStoredGlobal({
      id: 1,
      siteTitle: 'Live',
      _status: 'published',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    })
    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db: mock.db,
        collections: [],
        globals: [
          global({
            slug: 'settings',
            access: { read: () => true, update: () => true },
            versions: { drafts: true },
            fields: { siteTitle: f.text({ required: true }) },
          }),
        ],
      }),
    )
    const save = (query: string, siteTitle: string) =>
      lontar.fetch(
        new Request(`http://localhost/api/globals/settings?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ siteTitle }),
        }),
      )
    const read = async (query = '') => {
      const res = await lontar.fetch(new Request(`http://localhost/api/globals/settings${query}`))
      expect(res.status).toBe(200)
      return ((await res.json()) as { siteTitle: string }).siteTitle
    }
    return { ...mock, lontar, save, read }
  }

  it('keeps the live global published across consecutive draft saves', async () => {
    const { save, read, getStoredGlobal, getVersions } = setup()

    expect((await save('draft=true', 'Draft A')).status).toBe(200)
    expect((await save('draft=true', 'Draft B')).status).toBe(200)

    expect(getStoredGlobal()).toMatchObject({ siteTitle: 'Live', _status: 'published' })
    expect(await read()).toBe('Live')
    expect(await read('?draft=true')).toBe('Draft B')
    expect(getVersions().every((v) => !('_isPublished' in v.snapshot))).toBe(true)
  })

  it('saves an autosave sent without draft as a draft', async () => {
    const { save, read, getStoredGlobal, getVersions } = setup()

    expect((await save('autosave=true', 'Autosaved')).status).toBe(200)

    expect(getStoredGlobal()).toMatchObject({ siteTitle: 'Live', _status: 'published' })
    expect(await read()).toBe('Live')
    expect(await read('?draft=true')).toBe('Autosaved')
    expect(getVersions().map((v) => v._status)).toEqual(['draft'])
  })

  it('keeps the live global published across consecutive autosaves', async () => {
    const { save, read, getStoredGlobal } = setup()

    await save('draft=true&autosave=true', 'Autosave 1')
    await save('draft=true&autosave=true', 'Autosave 2')

    expect(getStoredGlobal()).toMatchObject({ siteTitle: 'Live', _status: 'published' })
    expect(await read()).toBe('Live')
    expect(await read('?draft=true')).toBe('Autosave 2')
  })

  it('restores a version as a draft without touching the live global while a draft is pending', async () => {
    const { lontar, save, read, getStoredGlobal, getVersions } = setup()

    await save('draft=true', 'Draft A')
    const draftAId = getVersions()[0]!.id
    await save('draft=true', 'Draft B')

    const res = await lontar.fetch(
      new Request(`http://localhost/api/globals/settings/versions/${draftAId}/restore?draft=true`, {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(200)

    expect(getStoredGlobal()).toMatchObject({ siteTitle: 'Live', _status: 'published' })
    expect(await read('?draft=true')).toBe('Draft A')
  })

  it('returns 400 and leaves the live global unchanged when publishing an invalid draft snapshot', async () => {
    const { lontar, getStoredGlobal, getVersions } = setup()

    getVersions().push({
      id: 99,
      parentId: 1,
      versionNumber: 2,
      snapshot: { id: 1, siteTitle: '', _status: 'draft' },
      _status: 'draft',
      autosave: false,
      createdAt: new Date().toISOString(),
      createdBy: null,
    })

    const res = await lontar.fetch(
      new Request('http://localhost/api/globals/settings/publish', {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; issues: unknown[] }
    expect(body.error).toBe('Validation failed')
    expect(body.issues).toBeDefined()
    expect(body.issues.length).toBeGreaterThan(0)

    expect(getStoredGlobal()).toMatchObject({ siteTitle: 'Live', _status: 'published' })
  })

  it('unpublish with a pending draft keeps the draft values in the draft read', async () => {
    const { lontar, save, read, getStoredGlobal, getVersions } = setup()

    await save('draft=true', 'Draft A')
    expect(await read('?draft=true')).toBe('Draft A')
    expect(getStoredGlobal()).toMatchObject({ siteTitle: 'Live', _status: 'published' })

    const unpubRes = await lontar.fetch(
      new Request('http://localhost/api/globals/settings/unpublish', {
        method: 'POST',
      }),
    )
    expect(unpubRes.status).toBe(200)
    const unpubDoc = (await unpubRes.json()) as { siteTitle: string; _status: string }
    expect(unpubDoc).toMatchObject({ siteTitle: 'Draft A', _status: 'draft' })

    // Stored global in DB is now unpublished (draft)
    expect(getStoredGlobal()).toMatchObject({ siteTitle: 'Live', _status: 'draft' })

    // Draft read still returns the pending draft "Draft A"
    expect(await read('?draft=true')).toBe('Draft A')

    // Pending draft was not overwritten by a new draft version of "Live"
    expect(getVersions()).toHaveLength(1)
    expect(getVersions()[0]!.snapshot).toMatchObject({ siteTitle: 'Draft A', _status: 'draft' })

    // Public read returns empty object (hidden)
    expect(await read()).toBeUndefined()
  })
})

describe('Version history access on a publicly readable global', () => {
  const editor = { id: 'u1', email: 'editor@example.com' } as unknown as AuthUser
  const reader = { id: 'u2', email: 'reader@example.com' } as unknown as AuthUser

  function setup() {
    const mock = createMockAdapter()
    mock.setStoredGlobal({
      id: 1,
      siteTitle: 'Live',
      _status: 'published',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    })
    mock.getVersions().push({
      id: 1,
      parentId: 1,
      versionNumber: 1,
      snapshot: { id: 1, siteTitle: 'Unannounced', _status: 'draft' },
      _status: 'draft',
      autosave: false,
      createdAt: '2026-11-02T00:00:00.000Z',
      createdBy: null,
    })
    const config = defineConfig({
      secret: 'test-secret',
      db: mock.db,
      collections: [],
      globals: [
        global({
          slug: 'settings',
          access: { read: () => true, update: ({ user }) => user?.email === editor.email },
          versions: { drafts: true },
          fields: { siteTitle: f.text({ required: true }) },
        }),
      ],
    })
    return { lontar: createLontar(config), config }
  }

  it('rejects anonymous requests to the version endpoints', async () => {
    const { lontar } = setup()
    const status = async (path: string, method = 'GET') =>
      (await lontar.fetch(new Request(`http://localhost/api/globals/settings${path}`, { method })))
        .status

    expect(await status('/versions')).toBe(401)
    expect(await status('/versions/1')).toBe(401)
    expect(await status('/versions/1/restore', 'POST')).toBe(401)
  })

  it('rejects users who can read but not update', async () => {
    const { config } = setup()
    const client = await getLontar(config)
    const opts = { overrideAccess: false, user: reader }

    await expect(client.findGlobalVersions('settings', opts)).rejects.toMatchObject({
      status: 403,
    })
    await expect(client.findGlobalVersionByID('settings', 1, opts)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('allows users with update access', async () => {
    const { config } = setup()
    const client = await getLontar(config)
    const opts = { overrideAccess: false, user: editor }

    expect((await client.findGlobalVersions('settings', opts)).docs).toHaveLength(1)
    const version = await client.findGlobalVersionByID('settings', 1, opts)
    expect(version.snapshot.siteTitle).toBe('Unannounced')
  })
})
