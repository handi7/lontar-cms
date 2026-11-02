import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import { global } from '../../config/global'
import type { DatabaseAdapter } from '../../database/adapter'
import { DatabaseError, UniqueConstraintError } from '../../database/errors'
import { fields as f } from '../../fields'
import { createLontar } from '../create-lontar'

const publicAccess = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
}

function createErrorMockAdapter() {
  const mockFind = vi.fn()
  const mockFindByID = vi.fn()
  const mockCreate = vi.fn()
  const mockUpdate = vi.fn()
  const mockDelete = vi.fn()
  const mockFindGlobal = vi.fn()
  const mockUpdateGlobal = vi.fn()

  const db: DatabaseAdapter = {
    name: 'mock',
    find: mockFind,
    findByID: mockFindByID,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
    findGlobal: mockFindGlobal,
    updateGlobal: mockUpdateGlobal,
    toSchemaFile: () => '',
    migrate: () => Promise.resolve(),
  }

  return {
    db,
    mockFind,
    mockFindByID,
    mockCreate,
    mockUpdate,
    mockDelete,
    mockFindGlobal,
    mockUpdateGlobal,
  }
}

describe('API Error Handling and SQL Leak Prevention', () => {
  const postsCol = collection({
    slug: 'posts',
    access: publicAccess,
    fields: {
      title: f.text({ required: true }),
      slug: f.slug({ unique: true }),
    },
  })

  const headerGlobal = global({
    slug: 'header',
    access: publicAccess,
    fields: {
      siteTitle: f.text({ required: true }),
      code: f.slug({ unique: true }),
    },
  })

  it('maps UniqueConstraintError on create to 400 validation error with field issue', async () => {
    const { db, mockCreate } = createErrorMockAdapter()
    mockCreate.mockRejectedValue(
      new UniqueConstraintError('Value "duplicate-slug" is already taken for field "slug"', {
        field: 'slug',
        value: 'duplicate-slug',
      }),
    )

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
        body: JSON.stringify({ title: 'My Post', slug: 'duplicate-slug' }),
      }),
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as {
      error: string
      issues: Array<{ path: string[]; message: string }>
    }
    expect(json.error).toBe('Validation failed')
    expect(json.issues).toHaveLength(1)
    expect(json.issues[0]?.path).toEqual(['slug'])
    expect(json.issues[0]?.message).toBe('Value "duplicate-slug" is already taken')
  })

  it('maps UniqueConstraintError on update to 400 validation error with field issue', async () => {
    const { db, mockFindByID, mockUpdate } = createErrorMockAdapter()
    mockFindByID.mockResolvedValue({
      id: 1,
      title: 'Existing Post',
      slug: 'old-slug',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    })

    mockUpdate.mockRejectedValue(
      new UniqueConstraintError('Value "taken-slug" is already taken for field "slug"', {
        field: 'slug',
        value: 'taken-slug',
      }),
    )

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
        body: JSON.stringify({ slug: 'taken-slug' }),
      }),
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as {
      error: string
      issues: Array<{ path: string[]; message: string }>
    }
    expect(json.error).toBe('Validation failed')
    expect(json.issues).toHaveLength(1)
    expect(json.issues[0]?.path).toEqual(['slug'])
    expect(json.issues[0]?.message).toBe('Value "taken-slug" is already taken')
  })

  it('does not leak SQL error messages and returns 500 JSON on database error during write', async () => {
    const { db, mockCreate } = createErrorMockAdapter()
    const rawSqlError = new DatabaseError('Database operation failed', {
      cause: new Error(
        'Failed query: insert into `posts` (`id`, `title`) values (default, ?)\nparams: secret_value',
      ),
    })
    mockCreate.mockRejectedValue(rawSqlError)

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
        body: JSON.stringify({ title: 'My Post' }),
      }),
    )

    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('Failed query')
    expect(text).not.toContain('secret_value')
    const json = JSON.parse(text) as { error: string }
    expect(json.error).toBe('Internal Server Error')
  })

  it('returns 500 JSON on read route errors instead of plain text', async () => {
    const { db, mockFind } = createErrorMockAdapter()
    mockFind.mockRejectedValue(
      new DatabaseError('Database operation failed', {
        cause: new Error('Failed query: select * from `posts`'),
      }),
    )

    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    const res = await lontar.fetch(new Request('http://localhost/api/posts'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Internal Server Error')
  })

  it('returns 500 JSON when findByID throws on read route', async () => {
    const { db, mockFindByID } = createErrorMockAdapter()
    mockFindByID.mockRejectedValue(new Error('Connection lost'))

    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [postsCol],
      }),
    )

    const res = await lontar.fetch(new Request('http://localhost/api/posts/1'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Internal Server Error')
  })

  it('maps UniqueConstraintError on global update to 400 validation error', async () => {
    const { db, mockFindGlobal, mockUpdateGlobal } = createErrorMockAdapter()
    mockFindGlobal.mockResolvedValue({
      id: 1,
      siteTitle: 'Site',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    })
    mockUpdateGlobal.mockRejectedValue(
      new UniqueConstraintError('Value "dup-code" is already taken for field "code"', {
        field: 'code',
        value: 'dup-code',
      }),
    )

    const lontar = createLontar(
      defineConfig({
        secret: 'test-secret',
        db,
        collections: [],
        globals: [headerGlobal],
      }),
    )

    const res = await lontar.fetch(
      new Request('http://localhost/api/globals/header', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'dup-code' }),
      }),
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as {
      error: string
      issues: Array<{ path: string[]; message: string }>
    }
    expect(json.error).toBe('Validation failed')
    expect(json.issues[0]?.path).toEqual(['code'])
    expect(json.issues[0]?.message).toBe('Value "dup-code" is already taken')
  })

  it('rejects string field exceeding 255 characters with a Zod validation issue instead of DB error', async () => {
    const { db, mockCreate } = createErrorMockAdapter()
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
        body: JSON.stringify({ title: 'a'.repeat(300) }),
      }),
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as {
      error: string
      issues: Array<{ path: string[]; message: string }>
    }
    expect(json.error).toBe('Validation failed')
    expect(json.issues[0]?.path).toEqual(['title'])
    expect(json.issues[0]?.message).toContain('<=255 characters')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
