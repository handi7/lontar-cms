import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter } from '../../database/adapter'
import type { StorageAdapter } from '../../storage'
import { registerCollectionRoutes } from './collection'

// #470, ADR 0030 §5 to §7: the file route serves a file only to a caller whose read constraint
// matches the document that owns it, including its resized variants.
const docs = [
  {
    id: 1,
    filename: 'cat.png',
    owner: 'u1',
    sizes: { thumb: { filename: 'cat-thumb.png' } },
  },
  { id: 2, filename: 'dog.png', owner: 'u2', sizes: { thumb: { filename: 'dog-thumb.png' } } },
]

function setup(options: { user: { id: string } | null }) {
  const find = vi.fn().mockImplementation(({ where }: { where: unknown }) => {
    const text = JSON.stringify(where)
    const owner = /"owner":\{"equals":"(\w+)"\}/.exec(text)?.[1]
    const found = docs.filter((d) => !owner || d.owner === owner)
    return Promise.resolve({ docs: found, totalDocs: found.length, page: 1 })
  })
  const read = vi.fn().mockResolvedValue(Buffer.from('bytes'))
  const storage = { name: 'mock', read } as unknown as StorageAdapter
  const config = defineConfig({
    secret: 'test-secret',
    db: { name: 'mock', find } as unknown as DatabaseAdapter,
    storage,
    collections: [
      {
        slug: 'media',
        upload: true,
        access: {
          read: ({ user }: { user: { id: string } | null }) =>
            user ? { owner: { equals: user.id } } : false,
        },
        fields: { owner: { type: 'text' } },
      } as never,
    ],
  })
  const app = new Hono<{ Variables: { user: unknown } }>()
  app.use('*', async (c, next) => {
    c.set('user', options.user)
    await next()
  })
  registerCollectionRoutes(app as never, config)
  return { app, read, find }
}

describe('file route under a read constraint (#470)', () => {
  it('serves the file of a document inside the constraint, privately', async () => {
    const { app } = setup({ user: { id: 'u1' } })

    const res = await app.request('/media/file/cat.png')

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('private')
    expect(res.headers.get('cache-control')).not.toContain('immutable')
  })

  it('serves a resized variant of a document inside the constraint', async () => {
    const { app } = setup({ user: { id: 'u1' } })

    const res = await app.request('/media/file/cat-thumb.png')

    expect(res.status).toBe(200)
  })

  it('answers 404, like a missing file, for a file outside the constraint', async () => {
    const { app, read } = setup({ user: { id: 'u1' } })

    const outside = await app.request('/media/file/dog.png')
    const outsideVariant = await app.request('/media/file/dog-thumb.png')
    const missing = await app.request('/media/file/nothing.png')

    expect(outside.status).toBe(404)
    expect(outsideVariant.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await outside.json()).toEqual(await missing.json())
    expect(read).not.toHaveBeenCalled()
  })

  it('does not serve a name that only resembles a variant of an owned document', async () => {
    const { app } = setup({ user: { id: 'u1' } })

    const res = await app.request('/media/file/cat-evil.png')

    expect(res.status).toBe(404)
  })

  it('is still denied when read access is false', async () => {
    const { app } = setup({ user: null })

    const res = await app.request('/media/file/cat.png')

    expect(res.status).toBe(401)
  })
})
