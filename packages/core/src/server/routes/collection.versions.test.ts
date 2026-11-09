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
    if (args.autosave) {
      const latest = [...versions].reverse().find((v) => v.parentId === args.parentId)
      if (latest && latest._status === 'draft' && latest.autosave) {
        latest.snapshot = args.snapshot
        latest.createdAt = new Date().toISOString()
        latest.createdBy = args.userId ?? null
        return Promise.resolve({ ...latest })
      }
    }

    const maxVer = versions
      .filter((v) => v.parentId === args.parentId)
      .reduce((max, v) => Math.max(max, v.versionNumber), 0)

    const newVersion: StoredVersion = {
      id: versions.length + 1,
      parentId: args.parentId,
      versionNumber: maxVer + 1,
      snapshot: args.snapshot,
      _status: args.status,
      autosave: Boolean(args.autosave),
      createdAt: '2026-10-31T00:00:00.000Z',
      createdBy: args.userId ?? null,
    }
    versions.push(newVersion)

    const maxPerDoc = args.collection.versions?.maxPerDoc ?? 50
    versions = pruneMockVersions(versions, args.parentId, maxPerDoc)

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

    // Reading with ?draft=true returns draft snapshot
    const resDraft = await app.request(`/api/posts/${doc1.id}?draft=true`)
    expect(resDraft.status).toBe(200)
    const draftDoc = (await resDraft.json()) as StoredDoc
    expect(draftDoc.title).toBe('Draft Edit')
    expect(draftDoc._status).toBe('draft')

    // Public read returns original published doc
    const resPublic = await app.request(`/api/posts/${doc1.id}`)
    expect(resPublic.status).toBe(200)
    const pubDoc = (await resPublic.json()) as StoredDoc
    expect(pubDoc.title).toBe('First Post')
    expect(pubDoc._status).toBe('published')
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
