import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter } from '../../database/adapter'
import { fields as f } from '../../fields'
import { createLontar } from '../create-lontar'

// #470, ADR 0030 §6 and §10: a document outside the read constraint is 404 here too.
function createApp() {
  const rows = [
    { id: 1, author: 'ann', title: 'Mine' },
    { id: 2, author: 'bob', title: 'Theirs' },
  ]
  const find = vi.fn().mockImplementation(({ where }: { where: unknown }) => {
    const text = JSON.stringify(where)
    const id = Number(/"id":\{"equals":(\d+)\}/.exec(text)?.[1])
    const docs = rows.filter((r) => r.id === id && r.author === 'ann')
    return Promise.resolve({ docs, totalDocs: docs.length, page: 1 })
  })
  const findByID = vi
    .fn()
    .mockImplementation(({ id }: { id: number }) =>
      Promise.resolve(rows.find((r) => r.id === id) ?? null),
    )
  const posts = collection({
    slug: 'posts',
    access: { read: () => ({ author: { equals: 'ann' } }) },
    fields: { title: f.text(), author: f.text() },
  })
  const app = createLontar(
    defineConfig({
      secret: 'test-secret-value-1234567890',
      db: { name: 'mock', find, findByID, findGlobal: vi.fn() } as unknown as DatabaseAdapter,
      collections: [posts],
    }),
    { baseURL: 'http://localhost:3000' },
  )
  return app
}

describe('permissions endpoints under a read constraint (#470)', () => {
  it('answers for a document inside the constraint', async () => {
    const res = await createApp().request('/api/_lontar/permissions/posts/1')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ read: true })
  })

  it('answers 404 for a document outside it, like one that does not exist', async () => {
    const app = createApp()

    const outside = await app.request('/api/_lontar/permissions/posts/2')
    const missing = await app.request('/api/_lontar/permissions/posts/99')

    expect(outside.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await outside.json()).toEqual({ error: 'Document with ID 2 not found' })
    expect(await missing.json()).toEqual({ error: 'Document with ID 99 not found' })
  })

  it('marks a constrained collection at list level', async () => {
    const res = await createApp().request('/api/_lontar/permissions')

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      collections: { posts: { read: boolean; constrained?: { read?: boolean } } }
    }
    expect(body.collections.posts).toMatchObject({ read: true, constrained: { read: true } })
  })
})
