import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter } from '../../database/adapter'
import { fields as f } from '../../fields'
import { createLontar } from '../create-lontar'

// #470, ADR 0030: a row outside a read constraint looks the same as a row that does not exist.
function createApp(rows: Array<{ id: number; author: string }>) {
  const find = vi.fn().mockImplementation((args: { where?: unknown }) => {
    const text = JSON.stringify(args.where)
    const wanted = /"equals":"(\w+)"\}\}/.exec(text)?.[1]
    const id = /"id":\{"equals":(\d+)\}/.exec(text)?.[1]
    const docs = rows.filter(
      (r) => (!wanted || r.author === wanted) && (!id || r.id === Number(id)),
    )
    return Promise.resolve({ docs, totalDocs: docs.length, page: 1, totalPages: 1, limit: 10 })
  })
  const findByID = vi
    .fn()
    .mockImplementation(({ id }: { id: number }) =>
      Promise.resolve(rows.find((r) => r.id === id) ?? null),
    )
  const del = vi
    .fn()
    .mockImplementation(({ id }: { id: number }) =>
      Promise.resolve(rows.find((r) => r.id === id) ?? null),
    )
  const posts = collection({
    slug: 'posts',
    access: {
      read: () => ({ author: { equals: 'ann' } }),
      update: () => ({ author: { equals: 'ann' } }),
      delete: () => ({ author: { equals: 'ann' } }),
    },
    fields: { title: f.text(), author: f.text() },
  })
  const app = createLontar(
    defineConfig({
      secret: 'test-secret-value-1234567890',
      db: { name: 'mock', find, findByID, delete: del } as unknown as DatabaseAdapter,
      collections: [posts],
    }),
    { baseURL: 'http://localhost:3000' },
  )
  return { app, find, del }
}

describe('row-level read constraint over REST (#470)', () => {
  it('constrains the list query', async () => {
    const { app, find } = createApp([{ id: 1, author: 'ann' }])

    const res = await app.request('/api/posts?where[title][equals]=x')

    expect(res.status).toBe(200)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ title: { equals: 'x' } }, { author: { equals: 'ann' } }] },
      }),
    )
  })

  it('answers a row outside the constraint exactly like a missing one', async () => {
    const { app } = createApp([
      { id: 1, author: 'ann' },
      { id: 2, author: 'bob' },
    ])

    const outside = await app.request('/api/posts/2')
    const missing = await app.request('/api/posts/99')
    const inside = await app.request('/api/posts/1')

    expect(inside.status).toBe(200)
    expect(outside.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await outside.json()).toEqual({ error: 'Document with ID 2 not found' })
    expect(await missing.json()).toEqual({ error: 'Document with ID 99 not found' })
  })
})

describe('row-level write constraints over REST (#470)', () => {
  it('answers DELETE and PATCH on a row outside the constraint like a missing one', async () => {
    const { app, del } = createApp([
      { id: 1, author: 'ann' },
      { id: 2, author: 'bob' },
    ])
    const json = { 'Content-Type': 'application/json' }

    const deleted = await app.request('/api/posts/2', { method: 'DELETE' })
    const patched = await app.request('/api/posts/2', {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ title: 'x' }),
    })

    expect(deleted.status).toBe(404)
    expect(patched.status).toBe(404)
    expect(await deleted.json()).toEqual({ error: 'Document with ID 2 not found' })
    expect(await patched.json()).toEqual({ error: 'Document with ID 2 not found' })
    expect(del).not.toHaveBeenCalled()
  })
})
