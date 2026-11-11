import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import { global } from '../../config/global'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import { drainPendingWebhooks, verifyWebhookSignature } from '../../webhooks'
import { createLontar } from '../create-lontar'

function createMockAdapter(
  storage: Map<number, StoredDoc> = new Map(),
  options?: {
    onTransactionStart?: () => void
    onTransactionCommit?: () => void
  },
) {
  let nextId = 1
  let inTx = false
  let txDepth = 0

  let globalStore: Record<string, unknown> = { siteName: 'Default Title' }

  const adapter: DatabaseAdapter = {
    name: 'mock',
    toSchemaFile: vi.fn().mockReturnValue(''),
    migrate: vi.fn().mockResolvedValue(undefined),
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
    findGlobal: vi.fn().mockImplementation(() => Promise.resolve({ ...globalStore })),
    updateGlobal: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      globalStore = { ...globalStore, ...data }
      return Promise.resolve({ ...globalStore })
    }),
    transaction: vi
      .fn()
      .mockImplementation(async (callback: (txDb: DatabaseAdapter) => Promise<unknown>) => {
        txDepth++
        const isOuter = txDepth === 1
        inTx = true
        if (isOuter) {
          options?.onTransactionStart?.()
        }
        try {
          const res = await callback(adapter)
          if (isOuter) {
            options?.onTransactionCommit?.()
          }
          return res
        } finally {
          txDepth--
          if (isOuter) {
            inTx = false
          }
        }
      }),
  }

  return {
    adapter,
    storage,
    isInTransaction: () => inTx,
    setGlobalDoc: (doc: Record<string, unknown>) => {
      globalStore = doc
    },
  }
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
  let onFetchCall: (() => void) | undefined

  beforeEach(() => {
    capturedDeliveries = []
    onFetchCall = undefined
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn<typeof fetch>((url: string | URL | Request, init?: RequestInit) => {
      onFetchCall?.()
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
    expect(delivery).toBeDefined()
    if (!delivery) throw new Error('expected delivery')
    expect(delivery.url).toBe('https://mysite.com/api/revalidate')

    const sig = delivery.headers.get('x-lontar-signature-256') ?? ''
    const ts = delivery.headers.get('x-lontar-timestamp') ?? ''
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(
      verifyWebhookSignature({ payload: delivery.body, signature: sig, secret, timestamp: ts }),
    ).toBe(true)

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
    const delivery = capturedDeliveries[0]
    expect(delivery).toBeDefined()
    if (!delivery) throw new Error('expected delivery')
    expect(delivery.url).toBe('https://mysite.com/change-listener')
    const payload = JSON.parse(delivery.body) as Record<string, unknown>
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
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery 0')
    expect(JSON.parse(d0.body)).toMatchObject({
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
    const d1 = capturedDeliveries[1]
    expect(d1).toBeDefined()
    if (!d1) throw new Error('expected delivery 1')
    expect(JSON.parse(d1.body)).toMatchObject({
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
    const d2 = capturedDeliveries[2]
    expect(d2).toBeDefined()
    if (!d2) throw new Error('expected delivery 2')
    expect(JSON.parse(d2.body)).toMatchObject({
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
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery')
    expect(d0.url).toBe('https://mysite.com/global-revalidate')
    const payload = JSON.parse(d0.body) as Record<string, unknown>
    expect(payload.event).toBe('update')
    expect(payload.global).toBe('settings')
  })

  it('admin-style PATCH draft: false on a draft document emits publish with previousStatus: draft', async () => {
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
          url: 'https://mysite.com/revalidate',
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
    const res = await app.request('/api/posts/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Published via PATCH', draft: false }),
    })

    expect(res.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery')
    const payload = JSON.parse(d0.body) as Record<string, unknown>
    expect(payload.event).toBe('publish')
    expect(payload.collection).toBe('posts')
    expect(payload.id).toBe(1)
    expect(payload.status).toBe('published')
    expect(payload.previousStatus).toBe('draft')
  })

  it('admin-style PATCH draft: false on an already-published document emits publish with previousStatus: published', async () => {
    const { adapter, storage } = createMockAdapter()
    storage.set(1, {
      id: 1,
      title: 'Published Post',
      _status: 'published',
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
          url: 'https://mysite.com/revalidate',
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
    const res = await app.request('/api/posts/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Edited Live Post', draft: false }),
    })

    expect(res.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery')
    const payload = JSON.parse(d0.body) as Record<string, unknown>
    expect(payload.event).toBe('publish')
    expect(payload.collection).toBe('posts')
    expect(payload.id).toBe(1)
    expect(payload.status).toBe('published')
    expect(payload.previousStatus).toBe('published')
  })

  it('creating a document as published in drafts collection emits publish', async () => {
    const { adapter } = createMockAdapter()
    const posts = collection({
      slug: 'posts',
      access: publicAccess,
      versions: { drafts: true },
      fields: { title: f.text() },
      webhooks: [
        {
          url: 'https://mysite.com/revalidate',
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
    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Directly Published Post', draft: false }),
    })

    expect(res.status).toBe(201)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery')
    const payload = JSON.parse(d0.body) as Record<string, unknown>
    expect(payload.event).toBe('publish')
    expect(payload.collection).toBe('posts')
    expect(payload.status).toBe('published')
    expect(payload.previousStatus).toBeUndefined()
  })

  it('global unpublish emits unpublish with previousStatus: published and status: draft', async () => {
    const { adapter, setGlobalDoc } = createMockAdapter()
    setGlobalDoc({ siteName: 'Published Site', _status: 'published' })

    const settings = global({
      slug: 'settings',
      access: publicAccess,
      versions: { drafts: true },
      fields: { siteName: f.text() },
      webhooks: [
        {
          url: 'https://mysite.com/global-revalidate',
          events: ['publish', 'unpublish', 'delete'],
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
    const res = await app.request('/api/globals/settings/unpublish', {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery')
    const payload = JSON.parse(d0.body) as Record<string, unknown>
    expect(payload.event).toBe('unpublish')
    expect(payload.global).toBe('settings')
    expect(payload.status).toBe('draft')
    expect(payload.previousStatus).toBe('published')
  })

  it('global update with draft: false on draft emits publish with previousStatus: draft', async () => {
    const { adapter, setGlobalDoc } = createMockAdapter()
    setGlobalDoc({ siteName: 'Draft Site', _status: 'draft' })

    const settings = global({
      slug: 'settings',
      access: publicAccess,
      versions: { drafts: true },
      fields: { siteName: f.text() },
      webhooks: [
        {
          url: 'https://mysite.com/global-revalidate',
          events: ['publish', 'unpublish', 'delete'],
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
      body: JSON.stringify({ siteName: 'Published Site', draft: false }),
    })

    expect(res.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery')
    const payload = JSON.parse(d0.body) as Record<string, unknown>
    expect(payload.event).toBe('publish')
    expect(payload.global).toBe('settings')
    expect(payload.status).toBe('published')
    expect(payload.previousStatus).toBe('draft')
  })

  it('global update with draft: false on published emits publish with previousStatus: published', async () => {
    const { adapter, setGlobalDoc } = createMockAdapter()
    setGlobalDoc({ siteName: 'Published Site', _status: 'published' })

    const settings = global({
      slug: 'settings',
      access: publicAccess,
      versions: { drafts: true },
      fields: { siteName: f.text() },
      webhooks: [
        {
          url: 'https://mysite.com/global-revalidate',
          events: ['publish', 'unpublish', 'delete'],
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
      body: JSON.stringify({ siteName: 'Updated Published Site', draft: false }),
    })

    expect(res.status).toBe(200)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(1)
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery')
    const payload = JSON.parse(d0.body) as Record<string, unknown>
    expect(payload.event).toBe('publish')
    expect(payload.global).toBe('settings')
    expect(payload.status).toBe('published')
    expect(payload.previousStatus).toBe('published')
  })

  it('dispatches delete webhook even when afterDelete hook throws (#247)', async () => {
    const { adapter, storage } = createMockAdapter()
    storage.set(1, {
      id: 1,
      title: 'Flaky Hook Post',
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    })

    const posts = collection({
      slug: 'posts',
      access: publicAccess,
      fields: { title: f.text() },
      hooks: {
        afterDelete: [
          () => {
            throw new Error('Flaky third-party service failed in afterDelete')
          },
        ],
      },
      webhooks: [
        {
          url: 'https://mysite.com/revalidate',
          events: ['delete'],
        },
      ],
    })

    const config = defineConfig({
      secret: 'app-secret',
      db: adapter,
      collections: [posts],
    })

    const app = createLontar(config)
    const deleteRes = await app.request('/api/posts/1', { method: 'DELETE' })
    expect(deleteRes.status).toBe(500)
    await drainPendingWebhooks()

    // The document was successfully deleted from storage
    expect(storage.has(1)).toBe(false)

    // The delete webhook was dispatched despite the throwing hook
    expect(capturedDeliveries).toHaveLength(1)
    const d0 = capturedDeliveries[0]
    expect(d0).toBeDefined()
    if (!d0) throw new Error('expected delivery')
    expect(JSON.parse(d0.body)).toMatchObject({
      event: 'delete',
      collection: 'posts',
      id: 1,
    })
  })

  it('commit ordering: publish and unpublish dispatch strictly after outer transaction commits', async () => {
    const executionOrder: string[] = []
    const { adapter, storage } = createMockAdapter(undefined, {
      onTransactionStart: () => {
        executionOrder.push('outer_tx:start')
      },
      onTransactionCommit: () => {
        executionOrder.push('outer_tx:commit')
      },
    })
    onFetchCall = () => {
      executionOrder.push('webhook:deliver')
    }

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
          url: 'https://mysite.com/revalidate',
          events: ['publish', 'unpublish'],
        },
      ],
    })

    const config = defineConfig({
      secret: 'app-secret',
      db: adapter,
      collections: [posts],
    })

    const app = createLontar(config)

    // Publish
    const publishRes = await app.request('/api/posts/1/publish', { method: 'POST' })
    expect(publishRes.status).toBe(200)
    await drainPendingWebhooks()

    expect(executionOrder).toEqual(['outer_tx:start', 'outer_tx:commit', 'webhook:deliver'])

    // Reset order tracking
    executionOrder.length = 0

    // Unpublish
    const unpublishRes = await app.request('/api/posts/1/unpublish', { method: 'POST' })
    expect(unpublishRes.status).toBe(200)
    await drainPendingWebhooks()

    expect(executionOrder).toEqual(['outer_tx:start', 'outer_tx:commit', 'webhook:deliver'])
  })

  it('commit ordering: does not deliver publish webhook when outer transaction fails or throws', async () => {
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
      hooks: {
        afterChange: [
          () => {
            throw new Error('Simulated failure during publish')
          },
        ],
      },
      webhooks: [
        {
          url: 'https://mysite.com/revalidate',
          events: ['publish'],
        },
      ],
    })

    const config = defineConfig({
      secret: 'app-secret',
      db: adapter,
      collections: [posts],
    })

    const app = createLontar(config)
    const res = await app.request('/api/posts/1/publish', { method: 'POST' })
    expect(res.status).toBe(500)
    await drainPendingWebhooks()

    // No webhook should be delivered because transaction failed
    expect(capturedDeliveries).toHaveLength(0)
  })

  it('commit ordering: global publish and unpublish dispatch strictly after outer transaction commits', async () => {
    const executionOrder: string[] = []
    const { adapter, setGlobalDoc } = createMockAdapter(undefined, {
      onTransactionStart: () => {
        executionOrder.push('outer_tx:start')
      },
      onTransactionCommit: () => {
        executionOrder.push('outer_tx:commit')
      },
    })
    onFetchCall = () => {
      executionOrder.push('webhook:deliver')
    }
    setGlobalDoc({ siteName: 'Draft Site', _status: 'draft' })

    const settings = global({
      slug: 'settings',
      access: publicAccess,
      versions: { drafts: true },
      fields: { siteName: f.text() },
      webhooks: [
        {
          url: 'https://mysite.com/revalidate',
          events: ['publish', 'unpublish'],
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

    // Publish
    const publishRes = await app.request('/api/globals/settings/publish', { method: 'POST' })
    expect(publishRes.status).toBe(200)
    await drainPendingWebhooks()

    expect(executionOrder).toEqual(['outer_tx:start', 'outer_tx:commit', 'webhook:deliver'])

    // Reset
    executionOrder.length = 0

    // Unpublish
    const unpublishRes = await app.request('/api/globals/settings/unpublish', { method: 'POST' })
    expect(unpublishRes.status).toBe(200)
    await drainPendingWebhooks()

    expect(executionOrder).toEqual(['outer_tx:start', 'outer_tx:commit', 'webhook:deliver'])
  })

  it('commit ordering: does not deliver global publish webhook when outer transaction fails', async () => {
    const { adapter, setGlobalDoc } = createMockAdapter()
    setGlobalDoc({ siteName: 'Draft Site', _status: 'draft' })

    const settings = global({
      slug: 'settings',
      access: publicAccess,
      versions: { drafts: true },
      fields: { siteName: f.text() },
      hooks: {
        afterChange: [
          () => {
            throw new Error('Simulated failure during global publish')
          },
        ],
      },
      webhooks: [
        {
          url: 'https://mysite.com/revalidate',
          events: ['publish'],
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
    const res = await app.request('/api/globals/settings/publish', { method: 'POST' })
    expect(res.status).toBe(500)
    await drainPendingWebhooks()

    expect(capturedDeliveries).toHaveLength(0)
  })
})
