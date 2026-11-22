import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { ApiKeyItem } from '../../auth/api-key'
import { RateLimiter } from '../../auth/rate-limit'
import type { AuthUser, LontarVariables } from '../../auth/types'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import { global } from '../../config/global'
import type { Config, Endpoint, EndpointHandler } from '../../config/types'
import type { DatabaseAdapter } from '../../database/adapter'
import { fields as f } from '../../fields'
import { createLontar } from '../create-lontar'
import { registerEndpointRoutes } from './endpoints'

type Env = { Variables: LontarVariables }

const editor = { id: 'u1', email: 'e@x.dev', role: 'editor' } as unknown as AuthUser
const apiKey = { id: 'k1' } as unknown as ApiKeyItem

interface Caller {
  user?: AuthUser | null
  apiKey?: ApiKeyItem | null
}

function setup(
  endpoints: {
    root?: Endpoint[]
    posts?: Endpoint[]
    site?: Endpoint[]
  },
  db: Partial<DatabaseAdapter> = {},
  rateLimiter?: RateLimiter,
) {
  const config = defineConfig({
    secret: 'test-secret-value-1234567890',
    db: { name: 'mock', ...db } as unknown as DatabaseAdapter,
    endpoints: endpoints.root,
    collections: [
      collection({ slug: 'posts', endpoints: endpoints.posts, fields: { title: f.text() } }),
    ],
    globals: [global({ slug: 'site', endpoints: endpoints.site, fields: { name: f.text() } })],
  }) as Config
  const router = new Hono<Env>()
  let caller: Caller = {}
  router.use('*', async (c, next) => {
    c.set('user', caller.user ?? null)
    c.set('apiKey', caller.apiKey ?? null)
    c.set('clientIp', c.req.header('x-forwarded-for') ?? 'unknown')
    await next()
  })
  // A built-in route that would shadow `/:collection/:id` style paths, to prove the ordering.
  registerEndpointRoutes(router, config, rateLimiter)
  router.get('/:collection', (c) => c.json({ builtIn: true }))
  router.get('/:collection/:id', (c) => c.json({ builtIn: true }))
  return {
    router,
    config,
    as: (next: Caller) => {
      caller = next
    },
  }
}

const ok = (name: string, path: string, extra: Partial<Endpoint> = {}): Endpoint => ({
  name,
  method: 'get',
  path,
  handler: (c) => c.json({ name }),
  ...extra,
})

describe('custom endpoints (#464)', () => {
  it('mounts root, collection and global endpoints ahead of the built-in routes', async () => {
    const { router, as } = setup({
      root: [ok('stats', '/stats')],
      posts: [ok('count', '/count')],
      site: [ok('ping', '/ping')],
    })
    as({ user: editor })

    expect(await (await router.request('/stats')).json()).toEqual({ name: 'stats' })
    // `/posts/count` would otherwise be answered by `/:collection/:id`.
    expect(await (await router.request('/posts/count')).json()).toEqual({ name: 'count' })
    expect(await (await router.request('/globals/site/ping')).json()).toEqual({ name: 'ping' })
    // Built-in routes still answer everything else.
    expect(await (await router.request('/posts/3')).json()).toEqual({ builtIn: true })
  })

  it('returns 401 without a user and 403 when access fails for a signed-in user', async () => {
    const { router, as } = setup({
      root: [
        ok('open', '/open'),
        ok('adminOnly', '/admin-only', { access: ({ user }) => user?.role === 'admin' }),
      ],
    })

    as({})
    expect((await router.request('/open')).status).toBe(401)
    expect((await router.request('/admin-only')).status).toBe(401)

    as({ user: editor })
    expect((await router.request('/open')).status).toBe(200)
    expect((await router.request('/admin-only')).status).toBe(403)
  })

  it('serves a public endpoint when access is () => true', async () => {
    const { router, as } = setup({ root: [ok('pub', '/pub', { access: () => true })] })
    as({})
    expect((await router.request('/pub')).status).toBe(200)
  })

  it('rejects API keys unless the endpoint sets apiKey: true', async () => {
    const { router, as } = setup({
      root: [ok('session', '/session'), ok('keyed', '/keyed', { apiKey: true })],
    })
    as({ user: editor, apiKey })

    expect((await router.request('/session')).status).toBe(403)
    expect((await router.request('/keyed')).status).toBe(200)
  })

  it('passes access the id, locale and request', async () => {
    const access = vi.fn().mockReturnValue(true)
    const { router, as } = setup({
      posts: [ok('approve', '/:id/approve', { method: 'post', access })],
    })
    as({ user: editor })

    await router.request('/posts/7/approve?locale=id', { method: 'POST' })

    expect(access).toHaveBeenCalledWith(
      expect.objectContaining({
        user: editor,
        id: 7,
        locale: 'id',
        req: expect.any(Request) as Request,
      }),
    )
  })

  it('parses :id strictly and answers 400 before the handler runs', async () => {
    const handler = vi.fn<EndpointHandler>((c) => c.json({ ok: true }))
    const { router, as } = setup({
      posts: [{ name: 'approve', method: 'post', path: '/:id/approve', handler }],
    })
    as({ user: editor })

    for (const bad of ['abc', '0', '-1', '12abc', '1.5']) {
      const res = await router.request(`/posts/${bad}/approve`, { method: 'POST' })
      expect(res.status, bad).toBe(400)
    }
    expect(handler).not.toHaveBeenCalled()

    const res = await router.request('/posts/12/approve', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('gives the handler the caller, the locale and a bound lontar', async () => {
    const find = vi.fn().mockResolvedValue({ docs: [], totalDocs: 0, page: 1, totalPages: 0 })
    let seen: unknown
    const { router, as } = setup(
      {
        root: [
          {
            name: 'who',
            method: 'get',
            path: '/who',
            apiKey: true,
            handler: async (c, ctx) => {
              seen = { user: ctx.user, apiKey: ctx.apiKey, locale: ctx.locale, id: ctx.id }
              await ctx.lontar.find('posts')
              return c.json({})
            },
          },
        ],
      },
      { find },
    )
    as({ user: editor, apiKey })

    await router.request('/who?locale=id')

    expect(seen).toEqual({ user: editor, apiKey, locale: 'id', id: undefined })
  })

  it('binds lontar to the caller: access is enforced unless the handler overrides it', async () => {
    const find = vi.fn().mockResolvedValue({ docs: [], totalDocs: 0, page: 1, totalPages: 0 })
    const denyRead = collection({
      slug: 'posts',
      access: { read: () => false },
      fields: { title: f.text() },
    })
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: { name: 'mock', find } as unknown as DatabaseAdapter,
      collections: [denyRead],
      endpoints: [
        {
          name: 'bound',
          method: 'get',
          path: '/bound',
          handler: async (c, { lontar }) => {
            try {
              await lontar.find('posts')
              return c.json({ denied: false })
            } catch {
              return c.json({ denied: true })
            }
          },
        },
        {
          name: 'elevated',
          method: 'get',
          path: '/elevated',
          handler: async (c, { lontar }) => {
            await lontar.find('posts', { overrideAccess: true })
            return c.json({ denied: false })
          },
        },
      ],
    }) as Config
    const router = new Hono<Env>()
    router.use('*', async (c, next) => {
      c.set('user', editor)
      await next()
    })
    registerEndpointRoutes(router, config)

    expect(await (await router.request('/bound')).json()).toEqual({ denied: true })
    expect(await (await router.request('/elevated')).json()).toEqual({ denied: false })
    expect(find).toHaveBeenCalledOnce()
  })

  it('rate limits per client IP and endpoint, and only when configured', async () => {
    const limiter = new RateLimiter({ enabled: true, storage: 'memory' })
    const { router, as } = setup(
      {
        root: [
          ok('limited', '/limited', { rateLimit: { window: 60, max: 2 } }),
          ok('other', '/other', { rateLimit: { window: 60, max: 2 } }),
          ok('free', '/free'),
        ],
      },
      {},
      limiter,
    )
    as({ user: editor })
    const hit = (path: string, ip: string) =>
      router.request(path, { headers: { 'x-forwarded-for': ip } })

    expect((await hit('/limited', '10.0.0.1')).status).toBe(200)
    expect((await hit('/limited', '10.0.0.1')).status).toBe(200)
    const blocked = await hit('/limited', '10.0.0.1')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()

    // Another endpoint, another IP and an unlimited endpoint are unaffected.
    expect((await hit('/other', '10.0.0.1')).status).toBe(200)
    expect((await hit('/limited', '10.0.0.2')).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await hit('/free', '10.0.0.1')).status).toBe(200)
  })
})

describe('custom endpoints through createLontar (#464)', () => {
  function app() {
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: { name: 'mock' } as unknown as DatabaseAdapter,
      collections: [
        collection({
          slug: 'posts',
          endpoints: [ok('count', '/count', { access: () => true })],
          fields: { title: f.text() },
        }),
      ],
      endpoints: [ok('stats', '/stats', { access: () => true })],
    })
    return createLontar(config, { baseURL: 'http://localhost:3000' })
  }

  it('answers custom paths under basePath instead of the collection routes', async () => {
    const a = app()
    expect(await (await a.request('/api/stats')).json()).toEqual({ name: 'stats' })
    expect(await (await a.request('/api/posts/count')).json()).toEqual({ name: 'count' })
  })

  it('honours a custom basePath', async () => {
    const config = defineConfig({
      secret: 'test-secret-value-1234567890',
      db: { name: 'mock' } as unknown as DatabaseAdapter,
      collections: [],
      endpoints: [ok('stats', '/stats', { access: () => true })],
    })
    const a = createLontar(config, { basePath: '/cms', baseURL: 'http://localhost:3000' })
    expect((await a.request('/cms/stats')).status).toBe(200)
  })
})
