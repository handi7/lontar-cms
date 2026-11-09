import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import { global } from '../../config/global'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import { drainPendingWebhooks, verifyWebhookSignature } from '../../webhooks'
import { createLontar } from '../create-lontar'

function createMockAdapter(storage: Map<number, StoredDoc> = new Map()) {
  let nextId = 1
  let inTx = false

  const adapter: DatabaseAdapter = {
    find: vi.fn().mockImplementation(() => {
      const docs = Array.from(storage.values())
      return Promise.resolve({
        docs,
        totalDocs: docs.length,
        limit: 10,
        page: 1,
        totalPages: 1,
      })
    }),
    findByID: vi.fn().mockImplementation(({ id }: { id: number }) => {
      return Promise.resolve(storage.get(id) ?? null)
    }),
    create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      const id = nextId++
      const doc: StoredDoc = {
        id,
        ...data,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      }
      storage.set(id, doc)
      return Promise.resolve(doc)
    }),
    update: vi
      .fn()
      .mockImplementation(({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const existing = storage.get(id)
        if (!existing) return Promise.resolve(null)
        const updated: StoredDoc = {
          ...existing,
          ...data,
          updatedAt: '2026-11-10T00:00:00.000Z',
        }
        storage.set(id, updated)
        return Promise.resolve(updated)
      }),
    delete: vi.fn().mockImplementation(({ id }: { id: number }) => {
      const existed = storage.has(id)
      storage.delete(id)
      return Promise.resolve(existed)
    }),
    saveVersion: vi.fn().mockResolvedValue(undefined),
    findVersions: vi.fn().mockResolvedValue({
      docs: [],
      totalDocs: 0,
      limit: 10,
      page: 1,
      totalPages: 1,
    }),
    findVersionByID: vi.fn().mockResolvedValue(null),
    findLatestDraftVersion: vi.fn().mockResolvedValue(null),
    findGlobal: vi.fn().mockResolvedValue({ siteName: 'Default Title' }),
    updateGlobal: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      return Promise.resolve({ siteName: 'Default Title', ...data })
    }),
    transaction: vi
      .fn()
      .mockImplementation(async (callback: (txDb: DatabaseAdapter) => Promise<unknown>) => {
        inTx = true
        try {
          const res = await callback(adapter)
          return res
        } finally {
          inTx = false
        }
      }),
  }

  return { adapter, storage, isInTransaction: () => inTx }
}

const publicAccess = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
}

describe('outgoing webhooks integration', () => {
  const secret = 'webhook-secret-key'
  let capturedDeliveries: Array<{ url: string; headers: Headers; body: string }> = []
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    capturedDeliveries = []
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn<typeof fetch>((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : 'url' in url ? url.url : url.toString()
      capturedDeliveries.push({
        url: urlStr,
        headers: new Headers(init?.headers),
        body: (init?.body as string) ?? '',
      })
      return Promise.resolve(new Response(JSON.stringify({ received: true }), { status: 200 }))
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('delivers webhook on successful create and signs payload with secret', async () => {
    const { adapter } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: publicAccess,
      fields: { title: f.text({ required: true }) },
      webhooks: [
        {
          url: 'https://mysite.com/api/revalidate',
          events: ['create'],
          secret,
        },
      ],
    })

    const config = defineConfig({
      secret: 'app-secret',
      db: adapter,
      collections: [posts],
    })

    const app = createLontar(config)
    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Post' }),
    })

    expect(res.status).toBe(201)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    const delivery = capturedDeliveries[0]
    expect(delivery.url).toBe('https://mysite.com/api/revalidate')

    const sig = delivery.headers.get('x-lontar-signature-256') ?? ''
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(verifyWebhookSignature({ payload: delivery.body, signature: sig, secret })).toBe(true)

    const payload = JSON.parse(delivery.body) as Record<string, unknown>
    expect(payload.event).toBe('create')
    expect(payload.collection).toBe('posts')
    expect(payload.id).toBe(1)
  })

  it('commit ordering: does not deliver webhook when transaction rolls back', async () => {
    const { adapter } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: publicAccess,
      fields: { title: f.text() },
      hooks: {
        afterChange: [
          () => {
            throw new Error('Simulated afterChange failure causing transaction rollback')
          },
        ],
      },
      webhooks: [
        {
          url: 'https://mysite.com/api/revalidate',
          events: ['create'],
        },
      ],
    })

    const config = defineConfig({
      secret: 'app-secret',
      db: adapter,
      collections: [posts],
    })

    const app = createLontar(config)
    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Will Fail' }),
    })

    expect(res.status).toBe(500)
    await drainPendingWebhooks()

    // No webhook should have fired because the transaction rolled back!
    expect(capturedDeliveries).toHaveLength(0)
  })

  it('failure isolation: save succeeds even if webhook endpoint is dead or returns 500', async () => {
    const prevFetch = globalThis.fetch
    globalThis.fetch = vi.fn<typeof fetch>(() => {
      return Promise.reject(new Error('Connection refused (ECONNREFUSED)'))
    })

    try {
      const { adapter } = createMockAdapter()
      const posts = collection({
        slug: 'posts',
        access: publicAccess,
        fields: { title: f.text() },
        webhooks: [
          {
            url: 'https://dead-endpoint.com/webhook',
            events: ['create'],
          },
        ],
      })

      const config = defineConfig({
        secret: 'app-secret',
        db: adapter,
        collections: [posts],
      })

      const app = createLontar(config)
      const res = await app.request('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Resilient Post' }),
      })

      // The editor's save succeeds with 201!
      expect(res.status).toBe(201)
      const json = (await res.json()) as { title: string }
      expect(json.title).toBe('Resilient Post')

      await drainPendingWebhooks()
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  it('draft saves do not trigger publish webhooks, but trigger update/change webhooks', async () => {
    const { adapter, storage } = createMockAdapter()
    storage.set(1, {
      id: 1,
      title: 'Initial Title',
      _status: 'draft',
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    })

    const posts = collection({
      slug: 'posts',
      access: publicAccess,
      versions: { drafts: true },
      fields: { title: f.text() },
      webhooks: [
        {
          url: 'https://mysite.com/publish-only',
          events: ['publish'],
        },
        {
          url: 'https://mysite.com/change-listener',
          events: ['change'],
        },
      ],
    })

    const config = defineConfig({
      secret: 'app-secret',
      db: adapter,
      collections: [posts],
    })

    const app = createLontar(config)

    // Save draft update
    const res = await app.request('/api/posts/1?draft=true', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Draft Title' }),
    })

    expect(res.status).toBe(200)
    await drainPendingWebhooks()

    // publish-only was NOT notified, but change-listener WAS notified!
    expect(capturedDeliveries).toHaveLength(1)
    expect(capturedDeliveries[0].url).toBe('https://mysite.com/change-listener')
    const payload = JSON.parse(capturedDeliveries[0].body) as Record<string, unknown>
    expect(payload.event).toBe('update')
    expect(payload.status).toBe('draft')
  })

  it('delivers publish, unpublish, and delete events', async () => {
    const { adapter, storage } = createMockAdapter()
    storage.set(1, {
      id: 1,
      title: 'Draft Post',
      _status: 'draft',
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    })

    const posts = collection({
      slug: 'posts',
      access: publicAccess,
      versions: { drafts: true },
      fields: { title: f.text() },
      webhooks: [
        {
          url: 'https://mysite.com/lifecycle',
          events: ['publish', 'unpublish', 'delete'],
        },
      ],
    })

    const config = defineConfig({
      secret: 'app-secret',
      db: adapter,
      collections: [posts],
    })

    const app = createLontar(config)

    // 1. Publish
    const publishRes = await app.request('/api/posts/1/publish', { method: 'POST' })
    expect(publishRes.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    expect(JSON.parse(capturedDeliveries[0].body)).toMatchObject({
      event: 'publish',
      collection: 'posts',
      id: 1,
      status: 'published',
      previousStatus: 'draft',
    })

    // 2. Unpublish
    const unpublishRes = await app.request('/api/posts/1/unpublish', { method: 'POST' })
    expect(unpublishRes.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(2)
    expect(JSON.parse(capturedDeliveries[1].body)).toMatchObject({
      event: 'unpublish',
      collection: 'posts',
      id: 1,
      status: 'draft',
      previousStatus: 'published',
    })

    // 3. Delete
    const deleteRes = await app.request('/api/posts/1', { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(3)
    expect(JSON.parse(capturedDeliveries[2].body)).toMatchObject({
      event: 'delete',
      collection: 'posts',
      id: 1,
    })
  })

  it('delivers global webhooks on update', async () => {
    const { adapter } = createMockAdapter()
    const settings = global({
      slug: 'settings',
      access: publicAccess,
      fields: { siteName: f.text() },
      webhooks: [
        {
          url: 'https://mysite.com/global-revalidate',
          events: ['update'],
        },
      ],
    })

    const config = defineConfig({
      secret: 'app-secret',
      db: adapter,
      collections: [],
      globals: [settings],
    })

    const app = createLontar(config)
    const res = await app.request('/api/globals/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteName: 'Updated Site Title' }),
    })

    expect(res.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    expect(capturedDeliveries[0].url).toBe('https://mysite.com/global-revalidate')
    const payload = JSON.parse(capturedDeliveries[0].body) as Record<string, unknown>
    expect(payload.event).toBe('update')
    expect(payload.global).toBe('settings')
  })
})
