import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter } from '../../database/adapter'
import { fields as f } from '../../fields'
import { createLontar } from '../create-lontar'

function createApp(options: { read: () => boolean; localization?: boolean }) {
  const find = vi.fn().mockResolvedValue({
    docs: [{ id: 3, title: 'Hello' }],
    totalDocs: 1,
    page: 1,
    totalPages: 1,
    limit: 5,
  })
  const posts = collection({
    slug: 'posts',
    access: { read: options.read },
    fields: { title: f.text({ localized: options.localization }) },
  })
  const app = createLontar(
    defineConfig({
      secret: 'test-secret-value-1234567890',
      db: { name: 'mock', find } as unknown as DatabaseAdapter,
      collections: [posts],
      ...(options.localization
        ? { localization: { locales: ['en', 'id'], defaultLocale: 'en' } }
        : {}),
    }),
    { baseURL: 'http://localhost:3000' },
  )
  return { app, find }
}

describe('GET /api/_lontar/search (#463)', () => {
  it('returns the hits of a readable collection', async () => {
    const { app } = createApp({ read: () => true })

    const res = await app.request('/api/_lontar/search?q=hel')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [{ id: 3, title: 'Hello', collection: 'posts' }] })
  })

  it('returns no results, not an error, for a collection the caller cannot read', async () => {
    const { app, find } = createApp({ read: () => false })

    const res = await app.request('/api/_lontar/search?q=hel')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [] })
    expect(find).not.toHaveBeenCalled()
  })

  it('returns an empty list when q is missing', async () => {
    const { app, find } = createApp({ read: () => true })

    const res = await app.request('/api/_lontar/search')

    expect(await res.json()).toEqual({ results: [] })
    expect(find).not.toHaveBeenCalled()
  })

  it('rejects an unknown locale with 400', async () => {
    const { app } = createApp({ read: () => true, localization: true })

    const res = await app.request('/api/_lontar/search?q=hel&locale=xx')

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('Validation failed')
    expect(body.message).toContain('Unknown locale "xx"')
  })

  it('applies the requested locale', async () => {
    const { app, find } = createApp({ read: () => true, localization: true })

    await app.request('/api/_lontar/search?q=hel&locale=id')

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ locale: 'id' }))
  })
})
