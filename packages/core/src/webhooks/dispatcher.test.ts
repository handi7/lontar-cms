import { describe, expect, it, vi } from 'vitest'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import {
  buildWebhookPayload,
  dispatchWebhooks,
  drainPendingWebhooks,
  matchesEvent,
  resolveMatchingWebhooks,
} from './dispatcher'

describe('matchesEvent', () => {
  it('matches publish event', () => {
    expect(matchesEvent(['publish'], 'publish', 'published')).toBe(true)
    expect(matchesEvent(['publish'], 'unpublish', 'draft')).toBe(false)
    expect(matchesEvent(['publish'], 'delete')).toBe(false)
  })

  it('does not match publish when saving draft', () => {
    // Draft saves should never trigger publish webhooks
    expect(matchesEvent(['publish'], 'update', 'draft')).toBe(false)
    expect(matchesEvent(['publish'], 'create', 'draft')).toBe(false)
  })

  it('matches update and change on draft saves', () => {
    expect(matchesEvent(['update'], 'update', 'draft')).toBe(true)
    expect(matchesEvent(['change'], 'update', 'draft')).toBe(true)
    expect(matchesEvent(['change'], 'create', 'draft')).toBe(true)
  })

  it('matches change event for all mutation lifecycle actions', () => {
    expect(matchesEvent(['change'], 'create')).toBe(true)
    expect(matchesEvent(['change'], 'update')).toBe(true)
    expect(matchesEvent(['change'], 'publish')).toBe(true)
    expect(matchesEvent(['change'], 'unpublish')).toBe(true)
    expect(matchesEvent(['change'], 'delete')).toBe(false)
  })

  it('matches delete event only for delete action', () => {
    expect(matchesEvent(['delete'], 'delete')).toBe(true)
    expect(matchesEvent(['delete'], 'update')).toBe(false)
    expect(matchesEvent(['delete'], 'publish')).toBe(false)
  })
})

describe('resolveMatchingWebhooks', () => {
  const collectionPosts: CollectionConfig = {
    slug: 'posts',
    fields: {},
    webhooks: [
      {
        url: 'https://example.com/posts-only',
        events: ['publish'],
      },
    ],
  }

  const collectionPages: CollectionConfig = {
    slug: 'pages',
    fields: {},
  }

  const globalSettings: GlobalConfig = {
    slug: 'site-settings',
    fields: {},
    webhooks: [
      {
        url: 'https://example.com/settings',
        events: ['update'],
      },
    ],
  }

  const config: Config = {
    secret: 'test-secret',
    db: {} as unknown as Config['db'],
    collections: [collectionPosts, collectionPages],
    globals: [globalSettings],
    webhooks: [
      {
        url: 'https://example.com/all-collections',
        collections: '*',
        events: ['publish', 'delete'],
      },
      {
        url: 'https://example.com/pages-only',
        collections: ['pages'],
        events: ['update'],
      },
      {
        url: 'https://example.com/all-globals',
        globals: '*',
        events: ['update'],
      },
    ],
  }

  it('resolves collection webhooks and matching root webhooks for posts publish', () => {
    const matching = resolveMatchingWebhooks({
      config,
      collection: collectionPosts,
      action: 'publish',
      status: 'published',
    })
    expect(matching.map((w) => w.url)).toEqual([
      'https://example.com/posts-only',
      'https://example.com/all-collections',
    ])
  })

  it('excludes publish webhooks when saving a draft of a post', () => {
    const matching = resolveMatchingWebhooks({
      config,
      collection: collectionPosts,
      action: 'update',
      status: 'draft',
    })
    expect(matching).toEqual([])
  })

  it('resolves pages webhook for page update', () => {
    const matching = resolveMatchingWebhooks({
      config,
      collection: collectionPages,
      action: 'update',
      status: 'published',
    })
    expect(matching.map((w) => w.url)).toEqual(['https://example.com/pages-only'])
  })

  it('resolves global webhooks and matching root webhooks for global update', () => {
    const matching = resolveMatchingWebhooks({
      config,
      global: globalSettings,
      action: 'update',
    })
    expect(matching.map((w) => w.url)).toEqual([
      'https://example.com/settings',
      'https://example.com/all-globals',
    ])
  })
})

describe('buildWebhookPayload', () => {
  const collection: CollectionConfig = { slug: 'posts', fields: {} }
  const doc = { id: 10, title: 'Hello World', secretField: 'hidden' }

  it('builds minimal metadata payload by default', () => {
    const payload = buildWebhookPayload({
      event: 'publish',
      collection,
      doc,
      status: 'published',
      previousStatus: 'draft',
    })

    expect(typeof payload.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false)
    expect(payload.event).toBe('publish')
    expect(payload.collection).toBe('posts')
    expect(payload.id).toBe(10)
    expect(payload.status).toBe('published')
    expect(payload.previousStatus).toBe('draft')
    expect(payload.doc).toBeUndefined()
  })

  it('includes document snapshot when includeDoc is true', () => {
    const payload = buildWebhookPayload({
      event: 'update',
      collection,
      doc,
      status: 'draft',
      includeDoc: true,
    })

    expect(payload.doc).toEqual(doc)
  })

  it('builds global payload without id', () => {
    const global: GlobalConfig = { slug: 'site-settings', fields: {} }
    const payload = buildWebhookPayload({
      event: 'update',
      global,
      doc: { siteName: 'My Blog' },
    })

    expect(typeof payload.timestamp).toBe('string')
    expect(payload.event).toBe('update')
    expect(payload.global).toBe('site-settings')
    expect(payload.id).toBeUndefined()
    expect(payload.collection).toBeUndefined()
  })
})

describe('dispatchWebhooks', () => {
  it('skips delivery when autosave is true', async () => {
    const mockFetch = vi.fn<typeof fetch>()
    const collection: CollectionConfig = {
      slug: 'posts',
      fields: {},
      webhooks: [{ url: 'https://example.com', events: ['update'] }],
    }

    const results = await dispatchWebhooks({
      collection,
      event: 'update',
      doc: { id: 1 },
      status: 'draft',
      autosave: true,
      options: { fetchFn: mockFetch },
    })

    expect(results).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('dispatches deliveries and drains pending properly', async () => {
    let capturedBody: string | undefined
    const mockFetch = vi.fn<typeof fetch>((_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? ''
      return Promise.resolve(new Response('OK', { status: 200 }))
    })

    const collection: CollectionConfig = {
      slug: 'posts',
      fields: {},
      webhooks: [{ url: 'https://example.com/webhook', events: ['publish'] }],
    }

    const promise = dispatchWebhooks({
      collection,
      event: 'publish',
      doc: { id: 1, title: 'Post 1' },
      status: 'published',
      previousStatus: 'draft',
      options: { fetchFn: mockFetch },
    })

    await drainPendingWebhooks()
    const results = await promise

    expect(results).toHaveLength(1)
    expect(results[0]?.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(capturedBody ?? '') as Record<string, unknown>
    expect(parsed.event).toBe('publish')
    expect(parsed.collection).toBe('posts')
    expect(parsed.id).toBe(1)
    expect(parsed.status).toBe('published')
    expect(parsed.previousStatus).toBe('draft')
    expect(typeof parsed.timestamp).toBe('string')
  })
})
