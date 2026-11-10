import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type {
  DatabaseAdapter,
  FindVersionsArgs,
  PaginatedVersions,
  SaveVersionArgs,
  StoredDoc,
  StoredVersion,
} from '../../database/adapter'
import type { AuthUser } from '../../auth/types'
import { fields as f } from '../../fields'
import { getLontar } from '../../local'
import { createLontar } from '../create-lontar'

function pruneMockVersions(
  versions: StoredVersion[],
  parentId: number,
  maxPerDoc: number,
): StoredVersion[] {
  if (maxPerDoc <= 0) return versions
  const docVersions = versions.filter((v) => v.parentId === parentId).sort((a, b) => b.id - a.id)
  if (docVersions.length <= maxPerDoc) return versions
  const keepIds = new Set(docVersions.slice(0, maxPerDoc).map((v) => v.id))
  return versions.filter((v) => v.parentId !== parentId || keepIds.has(v.id))
}

function tryUpdateMockAutosave(
  versions: StoredVersion[],
  args: SaveVersionArgs,
): StoredVersion | null {
  if (!args.autosave) return null
  const latest = [...versions].reverse().find((v) => v.parentId === args.parentId)
  if (latest && latest._status === 'draft' && latest.autosave) {
    latest.snapshot = args.snapshot
    latest.createdAt = new Date().toISOString()
    latest.createdBy = args.userId ?? null
    return { ...latest }
  }
  return null
}

function createVersionsMockAdapter(initialDocs: StoredDoc[] = []) {
  const docs = [...initialDocs]
  let versions: StoredVersion[] = []

  const mockFind = vi.fn().mockImplementation(({ where }: { where?: unknown }) => {
    return Promise.resolve({
      docs,
      totalDocs: docs.length,
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

  const mockSaveVersion = vi.fn().mockImplementation((args: SaveVersionArgs) => {
    const autosaved = tryUpdateMockAutosave(versions, args)
    if (autosaved) {
      return Promise.resolve(autosaved)
    }

    const parentId = args.parentId ?? 1
    const maxVer = versions
      .filter((v) => v.parentId === parentId)
      .reduce((max, v) => Math.max(max, v.versionNumber), 0)

    const newVersion: StoredVersion = {
      id: versions.length + 1,
      parentId,
      versionNumber: maxVer + 1,
      snapshot: args.snapshot,
      _status: args.status,
      autosave: Boolean(args.autosave),
      createdAt: '2026-10-31T00:00:00.000Z',
      createdBy: args.userId ?? null,
    }
    versions.push(newVersion)

    const maxPerDoc = (args.collection ?? args.global)?.versions?.maxPerDoc ?? 50
    versions = pruneMockVersions(versions, parentId, maxPerDoc)

    return Promise.resolve({ ...newVersion })
  })

  const mockFindVersions = vi.fn().mockImplementation((args: FindVersionsArgs) => {
    const docVersions = versions
      .filter((v) => v.parentId === args.parentId)
      .sort((a, b) => b.id - a.id)
    return Promise.resolve<PaginatedVersions>({
      docs: docVersions,
      totalDocs: docVersions.length,
      limit: args.limit ?? 10,
      page: args.page ?? 1,
      totalPages: Math.ceil(docVersions.length / (args.limit ?? 10)) || 1,
    })
  })

  const mockFindVersionByID = vi
    .fn()
    .mockImplementation((args: { parentId: number; versionId: number }) => {
      const found = versions.find((v) => v.parentId === args.parentId && v.id === args.versionId)
      return Promise.resolve(found ? { ...found } : null)
    })

  const mockFindLatestDraftVersion = vi.fn().mockImplementation((args: { parentId: number }) => {
    const docVersions = versions
      .filter((v) => v.parentId === args.parentId)
      .sort((a, b) => b.id - a.id)
    const latest = docVersions[0]
    if (latest && latest._status === 'draft') {
      return Promise.resolve({ ...latest })
    }
    return Promise.resolve(null)
  })

  const adapter: DatabaseAdapter = {
    name: 'mock',
    find: mockFind,
    findByID: mockFindByID,
    create: mockCreate,
    update: mockUpdate,
    delete: vi.fn(),
    findGlobal: vi.fn().mockResolvedValue(null),
    updateGlobal: vi.fn().mockResolvedValue(null),
    toSchemaFile: vi.fn().mockReturnValue(''),
    migrate: vi.fn().mockResolvedValue(undefined),
    transaction: (cb) => cb(adapter),
    saveVersion: mockSaveVersion,
    findVersions: mockFindVersions,
    findVersionByID: mockFindVersionByID,
    findLatestDraftVersion: mockFindLatestDraftVersion,
  }

  return {
    adapter,
    getDocs: () => docs,
    getVersions: () => versions,
    mockFind,
    mockFindByID,
    mockSaveVersion,
    mockFindVersions,
    mockFindVersionByID,
    mockFindLatestDraftVersion,
  }
}

describe('Snapshot writes, version history API and retention', () => {
  it('stamps a version on document creation and updates', async () => {
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
      },
      fields: {
        title: f.text({ required: true }),
      },
    })

    const { adapter, getVersions, getDocs } = createVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [posts],
    })
    const app = createLontar(config)

    // Create published post
    const res1 = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'First Post' }),
    })
    expect(res1.status).toBe(201)
    const doc1 = (await res1.json()) as StoredDoc
    expect(doc1._status).toBe('published')

    expect(getVersions()).toHaveLength(1)
    expect(getVersions()[0]?.versionNumber).toBe(1)
    expect(getVersions()[0]?.snapshot.title).toBe('First Post')
    expect(getVersions()[0]?._status).toBe('published')

    // Edit as draft: parent row must remain published, snapshot written to versions table
    const res2 = await app.request(`/api/posts/${doc1.id}?draft=true`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Draft Edit' }),
    })
    expect(res2.status).toBe(200)

    // Parent row in DB stays published with original title
    expect(getDocs()[0]?.title).toBe('First Post')
    expect(getDocs()[0]?._status).toBe('published')

    // Version row holds the draft edit
    expect(getVersions()).toHaveLength(2)
    const v2 = getVersions()[1]
    expect(v2?.versionNumber).toBe(2)
    expect(v2?.snapshot.title).toBe('Draft Edit')
    expect(v2?._status).toBe('draft')

    // Reading with ?draft=true returns draft snapshot with _isPublished = true
    const resDraft = await app.request(`/api/posts/${doc1.id}?draft=true`)
    expect(resDraft.status).toBe(200)
    const draftDoc = (await resDraft.json()) as StoredDoc
    expect(draftDoc.title).toBe('Draft Edit')
    expect(draftDoc._status).toBe('draft')
    expect(draftDoc._isPublished).toBe(true)

    // Public read returns original published doc
    const resPublic = await app.request(`/api/posts/${doc1.id}`)
    expect(resPublic.status).toBe(200)
    const pubDoc = (await resPublic.json()) as StoredDoc
    expect(pubDoc.title).toBe('First Post')
    expect(pubDoc._status).toBe('published')
    expect(pubDoc._isPublished).toBe(true)
  })

  it('updates autosave row in place during continuous autosaves', async () => {
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
      },
      fields: {
        title: f.text({ required: true }),
      },
    })

    const initialDocs: StoredDoc[] = [
      {
        id: 1,
        title: 'Published Post',
        _status: 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const { adapter, getVersions } = createVersionsMockAdapter(initialDocs)
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [posts],
    })
    const app = createLontar(config)

    // First autosave creates a draft row with autosave = true
    const res1 = await app.request('/api/posts/1?draft=true&autosave=true', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Autosave 1' }),
    })
    expect(res1.status).toBe(200)
    expect(getVersions()).toHaveLength(1)
    expect(getVersions()[0]?.snapshot.title).toBe('Autosave 1')
    expect(getVersions()[0]?.autosave).toBe(true)

    // Second autosave updates that row in place
    const res2 = await app.request('/api/posts/1?draft=true&autosave=true', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Autosave 2' }),
    })
    expect(res2.status).toBe(200)
    expect(getVersions()).toHaveLength(1)
    expect(getVersions()[0]?.snapshot.title).toBe('Autosave 2')

    // Manual save creates a new permanent version row with autosave = false
    const res3 = await app.request('/api/posts/1?draft=true', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Manual Save' }),
    })
    expect(res3.status).toBe(200)
    expect(getVersions()).toHaveLength(2)
    expect(getVersions()[1]?.snapshot.title).toBe('Manual Save')
    expect(getVersions()[1]?.autosave).toBe(false)
  })

  it('prunes versions when exceeding maxPerDoc retention', async () => {
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true, maxPerDoc: 2 },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
      },
      fields: {
        title: f.text({ required: true }),
      },
    })

    const { adapter, getVersions } = createVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [posts],
    })
    const app = createLontar(config)

    // Version 1
    await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Version 1' }),
    })
    // Version 2
    await app.request('/api/posts/1?draft=true', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Version 2' }),
    })
    expect(getVersions()).toHaveLength(2)

    // Version 3 - exceeds maxPerDoc: 2, oldest version is pruned
    await app.request('/api/posts/1?draft=true', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Version 3' }),
    })
    expect(getVersions()).toHaveLength(2)
    expect(getVersions().map((v) => v.snapshot.title)).toEqual(['Version 2', 'Version 3'])
  })

  it('serves GET /:collection/:id/versions and GET /:collection/:id/versions/:versionId', async () => {
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
      },
      fields: {
        title: f.text({ required: true }),
      },
    })

    const { adapter, getVersions } = createVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [posts],
    })
    const app = createLontar(config)

    // Seed post with 2 versions
    await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Initial' }),
    })
    await app.request('/api/posts/1?draft=true', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Revision 2' }),
    })

    // List versions
    const listRes = await app.request('/api/posts/1/versions')
    expect(listRes.status).toBe(200)
    const listJson = (await listRes.json()) as PaginatedVersions
    expect(listJson.totalDocs).toBe(2)
    expect(listJson.docs[0]?.versionNumber).toBe(2)

    // Get single version
    const singleRes = await app.request(`/api/posts/1/versions/${getVersions()[0]?.id}`)
    expect(singleRes.status).toBe(200)
    const versionDoc = (await singleRes.json()) as StoredVersion
    expect(versionDoc.snapshot.title).toBe('Initial')

    // 404 on nonexistent version
    const notFoundRes = await app.request('/api/posts/1/versions/999')
    expect(notFoundRes.status).toBe(404)
  })

  it('restores historical version via POST /:collection/:id/versions/:versionId/restore and Local API', async () => {
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
      },
      fields: {
        title: f.text({ required: true }),
      },
    })

    const { adapter, getVersions, getDocs } = createVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [posts],
    })
    const app = createLontar(config)

    // Create published post (v1)
    await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'First Version' }),
    })
    const v1Id = getVersions()[0]!.id

    // Publish update (v2)
    await app.request('/api/posts/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Second Version' }),
    })

    expect(getDocs()[0]?.title).toBe('Second Version')
    expect(getVersions()).toHaveLength(2)

    // Restore v1 via REST endpoint
    const restoreRes = await app.request(`/api/posts/1/versions/${v1Id}/restore`, {
      method: 'POST',
    })
    expect(restoreRes.status).toBe(200)
    const restoredDoc = (await restoreRes.json()) as StoredDoc
    expect(restoredDoc.title).toBe('First Version')

    // Restoring wrote a new version (v3) rather than rewinding history
    expect(getVersions()).toHaveLength(3)
    expect(getVersions()[2]?.snapshot.title).toBe('First Version')
    expect(getDocs()[0]?.title).toBe('First Version')

    // Test Local API methods
    const client = await getLontar(config)
    const history = await client.findVersions('posts', 1)
    expect(history.totalDocs).toBe(3)

    const v1 = await client.findVersionByID('posts', 1, v1Id)
    expect(v1.snapshot.title).toBe('First Version')

    const v2Id = getVersions()[1]!.id
    const localRestored = await client.restoreVersion('posts', 1, v2Id)
    expect(localRestored.title).toBe('Second Version')
    expect(getVersions()).toHaveLength(4)
  })

  it('enforces read and update permissions on version routes', async () => {
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => false,
        update: () => false,
      },
      fields: {
        title: f.text({ required: true }),
      },
    })

    const initialDocs: StoredDoc[] = [
      {
        id: 1,
        title: 'Secret Post',
        _status: 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ]

    const { adapter } = createVersionsMockAdapter(initialDocs)
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [posts],
    })
    const app = createLontar(config)

    // Listing versions rejects with 401 (unauthenticated read denied)
    const listRes = await app.request('/api/posts/1/versions')
    expect(listRes.status).toBe(401)

    // Viewing single version rejects with 401
    const singleRes = await app.request('/api/posts/1/versions/1')
    expect(singleRes.status).toBe(401)

    // Restoring version rejects with 401 (unauthenticated update denied)
    const restoreRes = await app.request('/api/posts/1/versions/1/restore', {
      method: 'POST',
    })
    expect(restoreRes.status).toBe(401)
  })
})

describe('Draft revisions of a published document', () => {
  const publishedPost: StoredDoc = {
    id: 1,
    title: 'Live',
    _status: 'published',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
  }

  function setup() {
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
      },
      fields: {
        title: f.text({ required: true }),
      },
    })
    const mock = createVersionsMockAdapter([{ ...publishedPost }])
    const app = createLontar(
      defineConfig({ secret: 'test-secret', db: mock.adapter, collections: [posts] }),
    )
    const patch = (query: string, title: string) =>
      app.request(`/api/posts/1?${query}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
    return { ...mock, app, patch }
  }

  async function expectLiveUnchanged(
    app: ReturnType<typeof createLontar>,
    getDocs: () => StoredDoc[],
  ) {
    expect(getDocs()[0]).toMatchObject({ title: 'Live', _status: 'published' })
    const res = await app.request('/api/posts/1')
    expect(res.status).toBe(200)
    expect(((await res.json()) as StoredDoc).title).toBe('Live')
  }

  async function readDraftTitle(app: ReturnType<typeof createLontar>) {
    const res = await app.request('/api/posts/1?draft=true')
    expect(res.status).toBe(200)
    return ((await res.json()) as StoredDoc).title
  }

  it('keeps the live row published across consecutive draft saves', async () => {
    const { app, patch, getDocs, getVersions } = setup()

    expect((await patch('draft=true', 'Draft A')).status).toBe(200)
    expect((await patch('draft=true', 'Draft B')).status).toBe(200)

    await expectLiveUnchanged(app, getDocs)
    expect(await readDraftTitle(app)).toBe('Draft B')
    expect(getVersions().map((v) => v._status)).toEqual(['draft', 'draft'])
    expect(getVersions().every((v) => !('_isPublished' in v.snapshot))).toBe(true)
  })

  it('saves an autosave sent without draft as a draft', async () => {
    const { app, patch, getDocs, getVersions } = setup()

    expect((await patch('autosave=true', 'Autosaved')).status).toBe(200)

    await expectLiveUnchanged(app, getDocs)
    expect(await readDraftTitle(app)).toBe('Autosaved')
    expect(getVersions().map((v) => v._status)).toEqual(['draft'])
  })

  it('keeps the live row published across consecutive autosaves', async () => {
    const { app, patch, getDocs, getVersions } = setup()

    expect((await patch('draft=true&autosave=true', 'Autosave 1')).status).toBe(200)
    expect((await patch('draft=true&autosave=true', 'Autosave 2')).status).toBe(200)
    expect((await patch('draft=true&autosave=true', 'Autosave 3')).status).toBe(200)

    await expectLiveUnchanged(app, getDocs)
    expect(await readDraftTitle(app)).toBe('Autosave 3')
    expect(getVersions()).toHaveLength(1)
  })

  it('restores a version as a draft without touching the live row while a draft is pending', async () => {
    const { app, patch, getDocs, getVersions } = setup()

    await patch('draft=true', 'Draft A')
    const draftAId = getVersions()[0]!.id
    await patch('draft=true', 'Draft B')

    const res = await app.request(`/api/posts/1/versions/${draftAId}/restore?draft=true`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)

    await expectLiveUnchanged(app, getDocs)
    expect(await readDraftTitle(app)).toBe('Draft A')
  })

  it('publishes the pending draft over the live row', async () => {
    const { app, patch, getDocs } = setup()

    await patch('draft=true', 'Draft A')
    await patch('draft=true', 'Draft B')
    const res = await app.request('/api/posts/1/publish', { method: 'POST' })
    expect(res.status).toBe(200)

    expect(getDocs()[0]).toMatchObject({ title: 'Draft B', _status: 'published' })
  })

  it('locks row with forUpdate and reads latest draft within the transaction when publishing (#245)', async () => {
    const { app, patch, mockFindByID, mockFindLatestDraftVersion } = setup()

    await patch('draft=true', 'Draft to Publish')
    mockFindByID.mockClear()
    mockFindLatestDraftVersion.mockClear()

    const res = await app.request('/api/posts/1/publish', { method: 'POST' })
    expect(res.status).toBe(200)

    expect(mockFindByID).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        forUpdate: true,
      }),
    )

    expect(mockFindLatestDraftVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 1,
      }),
    )
  })

  it('returns 400 and leaves the parent row unchanged when publishing an invalid draft snapshot', async () => {
    const { app, getDocs, getVersions } = setup()

    getVersions().push({
      id: 99,
      parentId: 1,
      versionNumber: 2,
      snapshot: { id: 1, title: '', _status: 'draft' },
      _status: 'draft',
      autosave: false,
      createdAt: new Date().toISOString(),
      createdBy: null,
    })

    const res = await app.request('/api/posts/1/publish', { method: 'POST' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; issues: unknown[] }
    expect(body.error).toBe('Validation failed')
    expect(body.issues).toBeDefined()
    expect(body.issues.length).toBeGreaterThan(0)

    expect(getDocs()[0]).toMatchObject({ title: 'Live', _status: 'published' })
  })

  it('unpublish with a pending draft keeps the draft values in the draft read', async () => {
    const { app, patch, getDocs, getVersions } = setup()

    await patch('draft=true', 'Draft A')
    expect(await readDraftTitle(app)).toBe('Draft A')
    expect(getDocs()[0]).toMatchObject({ title: 'Live', _status: 'published' })

    const unpublishRes = await app.request('/api/posts/1/unpublish', { method: 'POST' })
    expect(unpublishRes.status).toBe(200)
    const unpublishDoc = (await unpublishRes.json()) as StoredDoc
    expect(unpublishDoc).toMatchObject({ title: 'Draft A', _status: 'draft' })

    // Parent row is unpublished in DB
    expect(getDocs()[0]).toMatchObject({ title: 'Live', _status: 'draft' })

    // Draft read still returns pending draft "Draft A"
    expect(await readDraftTitle(app)).toBe('Draft A')

    // Pending draft was not overwritten by a new draft version of "Live"
    expect(getVersions()).toHaveLength(1)
    expect(getVersions()[0]!.snapshot).toMatchObject({ title: 'Draft A', _status: 'draft' })

    // Public read returns 404
    const publicRes = await app.request('/api/posts/1')
    expect(publicRes.status).toBe(404)
  })
})

describe('Version history access on a publicly readable collection', () => {
  const editor = { id: 'u1', email: 'editor@example.com' } as unknown as AuthUser
  const reader = { id: 'u2', email: 'reader@example.com' } as unknown as AuthUser

  function setup() {
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => true,
        update: ({ user }) => user?.email === editor.email,
      },
      fields: {
        title: f.text({ required: true }),
      },
    })
    const mock = createVersionsMockAdapter([
      {
        id: 1,
        title: 'Unpublished',
        _status: 'draft',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ])
    mock.getVersions().push({
      id: 1,
      parentId: 1,
      versionNumber: 1,
      snapshot: { id: 1, title: 'Unpublished', _status: 'draft' },
      _status: 'draft',
      autosave: false,
      createdAt: '2026-10-31T00:00:00.000Z',
      createdBy: null,
    })
    const config = defineConfig({ secret: 'test-secret', db: mock.adapter, collections: [posts] })
    return { app: createLontar(config), config }
  }

  it('rejects anonymous requests to the version endpoints', async () => {
    const { app } = setup()

    expect((await app.request('/api/posts/1')).status).toBe(404)
    expect((await app.request('/api/posts/1/versions')).status).toBe(401)
    expect((await app.request('/api/posts/1/versions/1')).status).toBe(401)
    expect((await app.request('/api/posts/1/versions/1/restore', { method: 'POST' })).status).toBe(
      401,
    )
  })

  it('rejects users who can read but not update', async () => {
    const { config } = setup()
    const client = await getLontar(config)
    const opts = { overrideAccess: false, user: reader }

    await expect(client.findVersions('posts', 1, opts)).rejects.toMatchObject({ status: 403 })
    await expect(client.findVersionByID('posts', 1, 1, opts)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('allows users with update access', async () => {
    const { config } = setup()
    const client = await getLontar(config)
    const opts = { overrideAccess: false, user: editor }

    const list = await client.findVersions('posts', 1, opts)
    expect(list.docs).toHaveLength(1)
    const version = await client.findVersionByID('posts', 1, 1, opts)
    expect(version.snapshot.title).toBe('Unpublished')
  })
})
