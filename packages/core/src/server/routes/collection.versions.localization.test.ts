import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import { global } from '../../config/global'
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

interface LocalizedDoc extends StoredDoc {
  title?: Record<string, string | null> | string | null
  content?: Record<string, string | null> | string | null
  tagline?: Record<string, string | null> | string | null
  slug?: string
}

function resolveFallbackValue(
  dict: Record<string, unknown>,
  fallbackLocale: string | false | undefined,
  defaultLocale: string,
): unknown {
  if (fallbackLocale === false) return null
  const fallback = typeof fallbackLocale === 'string' ? fallbackLocale : defaultLocale
  return dict[fallback] ?? null
}

function projectMockField(
  val: unknown,
  locale: string | undefined,
  fallbackLocale: string | false | undefined,
  defaultLocale: string,
): unknown {
  if (locale === 'all' || !val || typeof val !== 'object' || Array.isArray(val)) {
    return val
  }
  const dict = val as Record<string, unknown>
  const targetLocale = locale ?? defaultLocale
  const explicit = dict[targetLocale]
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    return explicit
  }
  return resolveFallbackValue(dict, fallbackLocale, defaultLocale)
}

function projectMockDoc(
  doc: LocalizedDoc,
  locale: string | undefined,
  fallbackLocale: string | false | undefined,
  defaultLocale: string,
): StoredDoc {
  if (locale === 'all') return { ...doc }
  const projected: Record<string, unknown> = { ...doc }
  for (const key of ['title', 'content', 'tagline']) {
    if (key in doc) {
      projected[key] = projectMockField(doc[key], locale, fallbackLocale, defaultLocale)
    }
  }
  return projected as StoredDoc
}

function mergeMockLocalizedField(
  existingVal: unknown,
  incomingVal: unknown,
  locale: string | undefined,
  defaultLocale: string,
): Record<string, unknown> {
  const dict: Record<string, unknown> =
    existingVal && typeof existingVal === 'object' && !Array.isArray(existingVal)
      ? { ...(existingVal as Record<string, unknown>) }
      : { en: null, id: null }

  if (
    locale === 'all' &&
    incomingVal &&
    typeof incomingVal === 'object' &&
    !Array.isArray(incomingVal)
  ) {
    return { ...dict, ...(incomingVal as Record<string, unknown>) }
  }

  const targetLocale = locale ?? defaultLocale
  dict[targetLocale] = incomingVal ?? null
  return dict
}

function updateMockRecord(
  existing: LocalizedDoc,
  data: Record<string, unknown>,
  locale: string | undefined,
  defaultLocale: string,
): LocalizedDoc {
  const updated: LocalizedDoc = {
    ...existing,
    ...data,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  }

  for (const key of ['title', 'content', 'tagline']) {
    if (key in data) {
      updated[key] = mergeMockLocalizedField(existing[key], data[key], locale, defaultLocale)
    }
  }
  return updated
}

function tryUpdateMockAutosave(
  versions: StoredVersion[],
  args: SaveVersionArgs,
): StoredVersion | null {
  if (!args.autosave || args.status !== 'draft') return null
  const latest = [...versions].reverse().find((v) => v.parentId === args.parentId)
  if (latest && latest._status === 'draft' && latest.autosave) {
    latest.snapshot = args.snapshot
    latest.createdAt = new Date().toISOString()
    latest.createdBy = args.userId ?? null
    return { ...latest }
  }
  return null
}

function createLocalizedVersionsMockAdapter(defaultLocale = 'en') {
  const docs: LocalizedDoc[] = []
  let globalDoc: LocalizedDoc | null = null
  const versions: StoredVersion[] = []

  const mockFind = vi
    .fn()
    .mockImplementation(
      ({ locale, fallbackLocale }: { locale?: string; fallbackLocale?: string | false }) => {
        const projected = docs.map((d) => projectMockDoc(d, locale, fallbackLocale, defaultLocale))
        return Promise.resolve({
          docs: projected,
          totalDocs: projected.length,
          limit: 10,
          page: 1,
          totalPages: 1,
        })
      },
    )

  const mockFindByID = vi
    .fn()
    .mockImplementation(
      ({
        id,
        locale,
        fallbackLocale,
      }: {
        id: number
        locale?: string
        fallbackLocale?: string | false
      }) => {
        const found = docs.find((d) => d.id === id)
        if (!found) return Promise.resolve(null)
        return Promise.resolve(projectMockDoc(found, locale, fallbackLocale, defaultLocale))
      },
    )

  const mockCreate = vi
    .fn()
    .mockImplementation(({ data, locale }: { data: Record<string, unknown>; locale?: string }) => {
      const newDoc: LocalizedDoc = {
        id: docs.length + 1,
        _status: data._status === 'draft' ? 'draft' : 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
        ...data,
      }
      for (const key of ['title', 'content', 'tagline']) {
        if (key in data) {
          newDoc[key] = mergeMockLocalizedField(undefined, data[key], locale, defaultLocale)
        }
      }
      docs.push(newDoc)
      return Promise.resolve(projectMockDoc(newDoc, locale, undefined, defaultLocale))
    })

  const mockUpdate = vi
    .fn()
    .mockImplementation(
      ({ id, data, locale }: { id: number; data: Record<string, unknown>; locale?: string }) => {
        const idx = docs.findIndex((d) => d.id === id)
        if (idx === -1) return Promise.resolve(null)
        const updated = updateMockRecord(docs[idx]!, data, locale, defaultLocale)
        docs[idx] = updated
        return Promise.resolve(projectMockDoc(updated, locale, undefined, defaultLocale))
      },
    )

  const mockFindGlobal = vi
    .fn()
    .mockImplementation(
      ({ locale, fallbackLocale }: { locale?: string; fallbackLocale?: string | false }) => {
        if (!globalDoc) return Promise.resolve(null)
        return Promise.resolve(projectMockDoc(globalDoc, locale, fallbackLocale, defaultLocale))
      },
    )

  const mockUpdateGlobal = vi
    .fn()
    .mockImplementation(({ data, locale }: { data: Record<string, unknown>; locale?: string }) => {
      const base: LocalizedDoc = globalDoc ?? {
        id: 1,
        _status: 'published',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      }
      const updated = updateMockRecord(base, data, locale, defaultLocale)
      globalDoc = updated
      return Promise.resolve(projectMockDoc(updated, locale, undefined, defaultLocale))
    })

  const mockSaveVersion = vi.fn().mockImplementation((args: SaveVersionArgs) => {
    const autosaved = tryUpdateMockAutosave(versions, args)
    if (autosaved) return Promise.resolve(autosaved)

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
    return Promise.resolve({ ...newVersion })
  })

  const mockFindVersions = vi.fn().mockImplementation((args: FindVersionsArgs) => {
    const docVersions = versions
      .filter((v) => v.parentId === args.parentId)
      .sort((a, b) => b.id - a.id)
    return Promise.resolve<PaginatedVersions>({
      docs: docVersions.map((v) => ({ ...v })),
      totalDocs: docVersions.length,
      limit: args.limit ?? 10,
      page: args.page ?? 1,
      totalPages: 1,
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
    findGlobal: mockFindGlobal,
    updateGlobal: mockUpdateGlobal,
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
    getGlobalDoc: () => globalDoc,
    getVersions: () => versions,
    mockFind,
    mockFindByID,
    mockCreate,
    mockUpdate,
    mockSaveVersion,
    mockFindVersions,
    mockFindVersionByID,
    mockFindLatestDraftVersion,
  }
}

describe('Versions with Localization (#425)', () => {
  const postsCollection = collection({
    slug: 'posts',
    access: {
      read: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    },
    versions: { drafts: true },
    fields: {
      title: f.text({ required: true, localized: true }),
      content: f.textarea({ localized: true }),
      slug: f.text(),
    },
  })

  const headerGlobal = global({
    slug: 'header',
    access: {
      read: () => true,
      update: () => true,
    },
    versions: { drafts: true },
    fields: {
      tagline: f.text({ required: true, localized: true }),
    },
  })

  it('creates document with canonical multi-locale version snapshot', async () => {
    const { adapter, getVersions, getDocs } = createLocalizedVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)

    const res = await app.request('/api/posts?locale=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'English Title',
        content: 'English body',
        slug: 'first-post',
      }),
    })

    expect(res.status).toBe(201)
    const doc = (await res.json()) as StoredDoc
    expect(doc._status).toBe('published')
    expect(doc.title).toBe('English Title')

    // Adapter stored canonical multi-locale dictionary in parent row
    expect(getDocs()[0]?.title).toEqual({ en: 'English Title', id: null })

    // Stored version snapshot contains the canonical dictionary
    const versions = getVersions()
    expect(versions).toHaveLength(1)
    expect(versions[0]?._status).toBe('published')
    expect(versions[0]?.snapshot.title).toEqual({ en: 'English Title', id: null })
    expect(versions[0]?.snapshot.slug).toBe('first-post')
  })

  it('draft edits isolate per-locale updates and do not clobber other locales', async () => {
    const { adapter, getVersions, getDocs } = createLocalizedVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)

    // 1. Create published in EN
    const resCreate = await app.request('/api/posts?locale=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'English Title',
        content: 'English body',
        slug: 'post-1',
      }),
    })
    expect(resCreate.status).toBe(201)

    // 2. Draft edit in ID: should not clobber EN in draft snapshot
    const resDraftId = await app.request('/api/posts/1?draft=true&locale=id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Judul Indonesia',
        content: 'Konten Indonesia',
      }),
    })
    expect(resDraftId.status).toBe(200)

    // Parent row remains published with original values
    expect(getDocs()[0]?._status).toBe('published')
    expect(getDocs()[0]?.title).toEqual({ en: 'English Title', id: null })

    // Version 2 is a draft snapshot containing both locales
    const versions = getVersions()
    expect(versions).toHaveLength(2)
    const v2 = versions[1]
    expect(v2?._status).toBe('draft')
    expect(v2?.snapshot.title).toEqual({
      en: 'English Title',
      id: 'Judul Indonesia',
    })
    expect(v2?.snapshot.content).toEqual({
      en: 'English body',
      id: 'Konten Indonesia',
    })

    // Reading with draft=true & locale=id returns projected ID draft
    const readDraftId = await app.request('/api/posts/1?draft=true&locale=id')
    expect(readDraftId.status).toBe(200)
    const draftIdDoc = (await readDraftId.json()) as StoredDoc
    expect(draftIdDoc.title).toBe('Judul Indonesia')
    expect(draftIdDoc.content).toBe('Konten Indonesia')
    expect(draftIdDoc._status).toBe('draft')
    expect(draftIdDoc._isPublished).toBe(true)

    // Reading with draft=true & locale=en returns projected EN draft
    const readDraftEn = await app.request('/api/posts/1?draft=true&locale=en')
    expect(readDraftEn.status).toBe(200)
    const draftEnDoc = (await readDraftEn.json()) as StoredDoc
    expect(draftEnDoc.title).toBe('English Title')
    expect(draftEnDoc.content).toBe('English body')
    expect(draftEnDoc._status).toBe('draft')
    expect(draftEnDoc._isPublished).toBe(true)

    // Public read in ID falls back to published EN (since ID is only in draft)
    const readPublicId = await app.request('/api/posts/1?locale=id')
    expect(readPublicId.status).toBe(200)
    const publicIdDoc = (await readPublicId.json()) as StoredDoc
    expect(publicIdDoc.title).toBe('English Title')
    expect(publicIdDoc._status).toBe('published')
  })

  it('consecutive autosaves in different locales merge into the draft revision', async () => {
    const { adapter, getVersions } = createLocalizedVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)

    // Initial post
    await app.request('/api/posts?locale=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Initial EN', content: 'Initial body' }),
    })

    // Autosave 1 in EN
    const resAutoEn = await app.request('/api/posts/1?draft=true&autosave=true&locale=en', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Draft EN Edit' }),
    })
    expect(resAutoEn.status).toBe(200)

    // Autosave 2 in ID
    const resAutoId = await app.request('/api/posts/1?draft=true&autosave=true&locale=id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Draft ID Edit' }),
    })
    expect(resAutoId.status).toBe(200)

    // The active draft snapshot must preserve both EN and ID
    const versions = getVersions()
    const latestDraft = versions.find((v) => v._status === 'draft')
    expect(latestDraft).toBeDefined()
    expect(latestDraft?.snapshot.title).toEqual({
      en: 'Draft EN Edit',
      id: 'Draft ID Edit',
    })
  })

  it('publishing a draft revision commits all locale translations to parent table', async () => {
    const { adapter, getVersions, getDocs } = createLocalizedVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)

    // 1. Create post
    await app.request('/api/posts?locale=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pub EN', content: 'Pub content' }),
    })

    // 2. Draft update in ID
    await app.request('/api/posts/1?draft=true&locale=id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pub ID', content: 'Pub konten' }),
    })

    // 3. Publish
    const resPublish = await app.request('/api/posts/1/publish?locale=id', {
      method: 'POST',
    })
    expect(resPublish.status).toBe(200)
    const publishedDoc = (await resPublish.json()) as StoredDoc
    expect(publishedDoc._status).toBe('published')
    expect(publishedDoc.title).toBe('Pub ID')

    // Parent row now contains committed translations for both locales
    const parentRow = getDocs()[0]
    expect(parentRow?._status).toBe('published')
    expect(parentRow?.title).toEqual({
      en: 'Pub EN',
      id: 'Pub ID',
    })
    expect(parentRow?.content).toEqual({
      en: 'Pub content',
      id: 'Pub konten',
    })

    // Version history has a published snapshot with all locales
    const versions = getVersions()
    const publishedVersion = versions[versions.length - 1]
    expect(publishedVersion?._status).toBe('published')
    expect(publishedVersion?.snapshot.title).toEqual({
      en: 'Pub EN',
      id: 'Pub ID',
    })

    // Public read in both locales returns their respective published translations
    const pubReadId = await app.request('/api/posts/1?locale=id')
    expect(pubReadId.status).toBe(200)
    expect(((await pubReadId.json()) as StoredDoc).title).toBe('Pub ID')

    const pubReadEn = await app.request('/api/posts/1?locale=en')
    expect(pubReadEn.status).toBe(200)
    expect(((await pubReadEn.json()) as StoredDoc).title).toBe('Pub EN')
  })

  it('restoring historical version restores all locales to that snapshot point', async () => {
    const { adapter, getDocs } = createLocalizedVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)

    // Version 1: only EN
    await app.request('/api/posts?locale=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'V1 EN Title' }),
    })

    // Version 2: edit and publish with ID
    await app.request('/api/posts/1?draft=true&locale=id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'V2 ID Title' }),
    })
    await app.request('/api/posts/1/publish?locale=en', { method: 'POST' })

    // Verify parent row has both
    expect(getDocs()[0]?.title).toEqual({
      en: 'V1 EN Title',
      id: 'V2 ID Title',
    })

    // Restore version 1
    const resRestore = await app.request('/api/posts/1/versions/1/restore?locale=id', {
      method: 'POST',
    })
    expect(resRestore.status).toBe(200)

    // Parent row restored to V1 data (id: null, en: 'V1 EN Title')
    expect(getDocs()[0]?.title).toEqual({
      en: 'V1 EN Title',
      id: null,
    })

    // Public read in ID falls back to V1 EN Title
    const resId = await app.request('/api/posts/1?locale=id')
    expect(((await resId.json()) as StoredDoc).title).toBe('V1 EN Title')
  })

  it('unpublishing sets _status to draft while preserving pending draft translations', async () => {
    const { adapter, getDocs } = createLocalizedVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)

    // 1. Create published
    await app.request('/api/posts?locale=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unpub Post' }),
    })

    // 2. Draft update in ID
    await app.request('/api/posts/1?draft=true&locale=id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unpub Post ID' }),
    })

    // 3. Unpublish
    const resUnpublish = await app.request('/api/posts/1/unpublish?locale=id', {
      method: 'POST',
    })
    expect(resUnpublish.status).toBe(200)

    // Parent row _status is draft
    expect(getDocs()[0]?._status).toBe('draft')

    // Unpublishing must not write the all-locales dictionary into a single locale (#480)
    expect(getDocs()[0]?.title).toEqual({ en: 'Unpub Post', id: null })

    // Reading with draft=true returns the draft in requested locale
    const resDraft = await app.request('/api/posts/1?draft=true&locale=id')
    expect(resDraft.status).toBe(200)
    expect(((await resDraft.json()) as StoredDoc).title).toBe('Unpub Post ID')
  })

  it('version list and single version reads project snapshots according to locale', async () => {
    const { adapter } = createLocalizedVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [postsCollection],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const lontar = await getLontar(config)

    // Create post
    await app.request('/api/posts?locale=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Article EN' }),
    })

    // Draft edit in ID
    await app.request('/api/posts/1?draft=true&locale=id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Artikel ID' }),
    })

    // 1. Find versions with locale=id -> projected snapshot
    const versionsId = await lontar.findVersions('posts', 1, {
      locale: 'id',
    })
    expect(versionsId.docs).toHaveLength(2)
    // Version 2 (draft) has ID title
    expect(versionsId.docs[0]?.snapshot.title).toBe('Artikel ID')
    // Version 1 (published) falls back to EN title
    expect(versionsId.docs[1]?.snapshot.title).toBe('Article EN')

    // 2. Find versions with locale=all -> canonical multi-locale dictionary
    const versionsAll = await lontar.findVersions('posts', 1, {
      locale: 'all',
    })
    expect(versionsAll.docs[0]?.snapshot.title).toEqual({
      en: 'Article EN',
      id: 'Artikel ID',
    })

    // 3. Find single version by ID with locale=id
    const v2Id = await lontar.findVersionByID('posts', 1, 2, {
      locale: 'id',
    })
    expect(v2Id?.snapshot.title).toBe('Artikel ID')

    // 4. Find single version by ID with locale=all
    const v2All = await lontar.findVersionByID('posts', 1, 2, {
      locale: 'all',
    })
    expect(v2All?.snapshot.title).toEqual({
      en: 'Article EN',
      id: 'Artikel ID',
    })
  })

  it('globals support localized drafts, autosave, publish and restore', async () => {
    const { adapter, getGlobalDoc } = createLocalizedVersionsMockAdapter()
    const config = defineConfig({
      secret: 'test-secret',
      db: adapter,
      collections: [],
      globals: [headerGlobal],
      localization: {
        locales: ['en', 'id'],
        defaultLocale: 'en',
      },
    })
    const app = createLontar(config)
    const lontar = await getLontar(config)

    // 1. Update published global in EN
    const resInit = await app.request('/api/globals/header?locale=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagline: 'English Tagline' }),
    })
    expect(resInit.status).toBe(200)

    // Initial snapshot contains { tagline: { en: 'English Tagline', id: null } }
    expect(getGlobalDoc()?.tagline).toEqual({ en: 'English Tagline', id: null })

    // 2. Draft update in ID
    const resDraftId = await app.request('/api/globals/header?draft=true&locale=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagline: 'Tagline Indonesia' }),
    })
    expect(resDraftId.status).toBe(200)

    // Global in DB stays published with original value
    expect(getGlobalDoc()?.tagline).toEqual({ en: 'English Tagline', id: null })
    expect(getGlobalDoc()?._status).toBe('published')

    // Draft read in ID returns draft tagline
    const draftIdRead = await app.request('/api/globals/header?draft=true&locale=id')
    expect(((await draftIdRead.json()) as StoredDoc).tagline).toBe('Tagline Indonesia')

    // Public read in ID falls back to published EN tagline
    const pubIdRead = await app.request('/api/globals/header?locale=id')
    expect(((await pubIdRead.json()) as StoredDoc).tagline).toBe('English Tagline')

    // 3. Publish global
    const resPub = await app.request('/api/globals/header/publish?locale=id', {
      method: 'POST',
    })
    expect(resPub.status).toBe(200)

    // DB global updated with both locales
    expect(getGlobalDoc()?.tagline).toEqual({
      en: 'English Tagline',
      id: 'Tagline Indonesia',
    })
    expect(getGlobalDoc()?._status).toBe('published')

    // 4. Restore version 1
    const resRestore = await lontar.restoreGlobalVersion('header', 1, {
      locale: 'id',
    })
    expect(resRestore.tagline).toBe('English Tagline') // fallback from EN
    expect(getGlobalDoc()?.tagline).toEqual({
      en: 'English Tagline',
      id: null,
    })
  })
})
