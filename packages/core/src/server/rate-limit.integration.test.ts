import { describe, expect, it } from 'vitest'
import { createApiKey } from '../auth/api-key'
import type { DatabaseAdapter } from '../database/adapter'
import type { Config } from '../config/types'
import { createLontar } from './create-lontar'
import type { DatabaseAdapterLike } from '../auth/rate-limit'

const dummyDoc = {
  id: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mockDbAdapter: DatabaseAdapter = {
  name: 'mock',
  find: () =>
    Promise.resolve({
      docs: [],
      totalDocs: 0,
      limit: 10,
      page: 1,
      totalPages: 0,
      hasPrevPage: false,
      hasNextPage: false,
      prevPage: null,
      nextPage: null,
    }),
  findByID: () => Promise.resolve(null),
  create: ({ data }) => Promise.resolve({ ...dummyDoc, ...data }),
  update: ({ data }) => Promise.resolve({ ...dummyDoc, ...data }),
  delete: () => Promise.resolve(dummyDoc),
  findGlobal: () => Promise.resolve(null),
  updateGlobal: ({ data }) => Promise.resolve({ ...dummyDoc, ...data }),
  toSchemaFile: () => '',
  migrate: () => Promise.resolve(),
}

describe('Rate Limiting Integration (/api/_lontar & /api/auth)', () => {
  it('rate limits POST /api/_lontar/first-user and returns 429 with Retry-After', async () => {
    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockDbAdapter,
      collections: [],
    }

    const app = createLontar(config, {
      ipAddressHeaders: ['x-forwarded-for'],
      rateLimit: {
        enabled: true,
        rules: {
          firstUser: { window: 60, max: 2 },
        },
      },
    })

    const attempt = () =>
      app.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.1' },
        body: JSON.stringify({ email: 'bad' }),
      })

    const r1 = await attempt()
    expect(r1.status).toBe(400) // validation error

    const r2 = await attempt()
    expect(r2.status).toBe(400) // validation error

    const r3 = await attempt()
    expect(r3.status).toBe(429)
    expect(r3.headers.get('Retry-After')).toBeDefined()
    expect(Number(r3.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(r3.headers.get('X-Retry-After')).toBeDefined()

    const json = (await r3.json()) as { error: string }
    expect(json.error).toBe('Too many requests. Please try again later.')

    // Another IP is not blocked
    const otherIpRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.2' },
      body: JSON.stringify({ email: 'bad' }),
    })
    expect(otherIpRes.status).toBe(400)
  })

  it('rate limits failed API key attempts and preserves unauthenticated and valid key traffic', async () => {
    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockDbAdapter,
      collections: [],
    }

    const app = createLontar(config, {
      ipAddressHeaders: ['x-forwarded-for'],
      rateLimit: {
        enabled: true,
        rules: {
          apiKeyFailure: { window: 60, max: 2 },
        },
      },
    })

    const badKeyAttempt = () =>
      app.request('/api/_lontar/me', {
        headers: {
          authorization: 'Bearer lt_invalidkeythatdoesnotexist12345',
          'x-forwarded-for': '203.0.113.50',
        },
      })

    // Attempt 1: invalid key -> 401
    const r1 = await badKeyAttempt()
    expect(r1.status).toBe(401)

    // Attempt 2: invalid key -> 401
    const r2 = await badKeyAttempt()
    expect(r2.status).toBe(401)

    // Attempt 3: invalid key -> 429
    const r3 = await badKeyAttempt()
    expect(r3.status).toBe(429)
    expect(r3.headers.get('Retry-After')).toBeDefined()
    expect(r3.headers.get('X-Retry-After')).toBeDefined()
    const r3Json = (await r3.json()) as { error: string }
    expect(r3Json.error).toBe('Too many failed API key attempts. Please try again later.')

    // Subsequent request from this IP with bad key is immediately blocked with 429
    const r4 = await badKeyAttempt()
    expect(r4.status).toBe(429)

    // Request from same IP without API key (session check) is not blocked
    const sessionRes = await app.request('/api/_lontar/me', {
      headers: {
        'x-forwarded-for': '203.0.113.50',
      },
    })
    expect(sessionRes.status).toBe(200)

    // Different IP with bad key is not blocked yet
    const otherIpRes = await app.request('/api/_lontar/me', {
      headers: {
        authorization: 'Bearer lt_invalidkeythatdoesnotexist12345',
        'x-forwarded-for': '203.0.113.99',
      },
    })
    expect(otherIpRes.status).toBe(401)
  })

  it('rate limits user invitation requests', async () => {
    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockDbAdapter,
      collections: [],
      auth: {
        roles: ['admin', 'editor'],
        defaultRole: 'editor',
        adminRole: 'admin',
      },
      email: {
        adapter: {
          sendEmail: () => Promise.resolve(),
        },
        from: 'no-reply@example.com',
      },
    }

    const app = createLontar(config, {
      baseURL: 'http://localhost:3000',
      ipAddressHeaders: ['x-forwarded-for'],
      rateLimit: {
        enabled: true,
        rules: {
          invite: { window: 60, max: 2 },
        },
      },
    })

    // 1. Setup admin
    const firstUserRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin',
        email: 'admin@example.com',
        password: 'password1234',
      }),
    })
    expect(firstUserRes.status).toBe(200)
    const adminCookie = firstUserRes.headers.get('set-cookie') ?? ''

    const invite = (email: string) =>
      app.request('/api/_lontar/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'x-forwarded-for': '192.0.2.10',
        },
        body: JSON.stringify({
          name: 'Invited',
          email,
          role: 'editor',
          invite: true,
        }),
      })

    const r1 = await invite('inv1@example.com')
    expect(r1.status).toBe(201)

    const r2 = await invite('inv2@example.com')
    expect(r2.status).toBe(201)

    const r3 = await invite('inv3@example.com')
    expect(r3.status).toBe(429)
    expect(r3.headers.get('Retry-After')).toBeDefined()
    expect(r3.headers.get('X-Retry-After')).toBeDefined()
    const r3Json = (await r3.json()) as { error: string }
    expect(r3Json.error).toBe('Too many invite requests. Please try again later.')
  })

  it('sets Retry-After on Better Auth 429 responses with customRules', async () => {
    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockDbAdapter,
      collections: [],
    }

    const app = createLontar(config, {
      ipAddressHeaders: ['x-forwarded-for'],
      rateLimit: {
        enabled: true,
        customRules: {
          '/sign-in/*': { window: 60, max: 2 },
        },
      },
    })

    const signIn = () =>
      app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.88' },
        body: JSON.stringify({ email: 'bad@example.com', password: 'wrong' }),
      })

    const r1 = await signIn()
    expect(r1.status).toBe(401)

    const r2 = await signIn()
    expect(r2.status).toBe(401)

    const r3 = await signIn()
    expect(r3.status).toBe(429)
    expect(r3.headers.get('Retry-After')).toBeDefined()
    expect(Number(r3.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(r3.headers.get('X-Retry-After')).toBeDefined()
  })

  function matchesCondition(
    row: { count: number; lastRequest: number },
    cond: { field: string; operator?: string; value: unknown },
  ): boolean {
    if (cond.field === 'count' && cond.operator === 'lt') {
      return row.count < (cond.value as number)
    }
    if (cond.field === 'lastRequest' && cond.operator === 'lte') {
      return row.lastRequest <= (cond.value as number)
    }
    return true
  }

  function applyIncrementSet(
    row: { count: number; lastRequest: number },
    increment: { count?: number },
    set?: { count?: unknown; lastRequest?: unknown },
  ): void {
    if (increment.count) row.count += increment.count
    if (set?.count !== undefined) row.count = Number(set.count)
    if (set?.lastRequest !== undefined) row.lastRequest = Number(set.lastRequest)
  }

  it('shares rate limits across multiple instances when using database storage', async () => {
    // In-memory fake database shared across both Lontar instances
    const dbRows: Array<{
      id: string
      key: string
      count: number
      lastRequest: number
    }> = []

    const sharedAdapter: DatabaseAdapterLike = {
      findMany: ({ where }) => {
        const keyCond = where.find((w) => w.field === 'key')
        if (!keyCond) return Promise.resolve([])
        return Promise.resolve(dbRows.filter((r) => r.key === keyCond.value))
      },
      create: ({ data }) => {
        dbRows.push({
          id: (data.id as string) ?? '1',
          key: data.key as string,
          count: Number(data.count ?? 1),
          lastRequest: Number(data.lastRequest ?? Date.now()),
        })
        return Promise.resolve(data)
      },
      incrementOne: ({ where, increment, set }) => {
        const keyCond = where.find((w) => w.field === 'key')
        const row = keyCond ? dbRows.find((r) => r.key === keyCond.value) : undefined
        if (!row) return Promise.resolve(false)

        const allMatch = where.every((cond) => matchesCondition(row, cond))
        if (!allMatch) return Promise.resolve(false)

        applyIncrementSet(row, increment, set)
        return Promise.resolve(true)
      },
    }

    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockDbAdapter,
      collections: [],
    }

    // Instance A
    const appA = createLontar(config, {
      ipAddressHeaders: ['x-forwarded-for'],
      rateLimit: {
        enabled: true,
        storage: 'database',
        customStorage: undefined, // will use DatabaseRateLimitStorage with shared adapter
        rules: { firstUser: { window: 60, max: 2 } },
      },
    })
    // Wire sharedAdapter to appA rateLimiter
    const rateLimiterA = appA as unknown as {
      auth: { $context: Promise<{ adapter: DatabaseAdapterLike }> }
    }
    const ctxA = await rateLimiterA.auth.$context
    ctxA.adapter = sharedAdapter

    // Instance B
    const appB = createLontar(config, {
      ipAddressHeaders: ['x-forwarded-for'],
      rateLimit: {
        enabled: true,
        storage: 'database',
        rules: { firstUser: { window: 60, max: 2 } },
      },
    })
    const rateLimiterB = appB as unknown as {
      auth: { $context: Promise<{ adapter: DatabaseAdapterLike }> }
    }
    const ctxB = await rateLimiterB.auth.$context
    ctxB.adapter = sharedAdapter

    const sendA = () =>
      appA.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.99' },
        body: JSON.stringify({ email: 'bad' }),
      })

    const sendB = () =>
      appB.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.99' },
        body: JSON.stringify({ email: 'bad' }),
      })

    // Instance A consumes 1
    const r1 = await sendA()
    expect(r1.status).toBe(400)

    // Instance A consumes 2
    const r2 = await sendA()
    expect(r2.status).toBe(400)

    // Instance B consumes 3 -> blocked across instances!
    const r3 = await sendB()
    expect(r3.status).toBe(429)
    expect(r3.headers.get('Retry-After')).toBeDefined()
  })

  it('rate limits failed password change attempts on /_lontar/me/password and returns 429 with Retry-After (#371)', async () => {
    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockDbAdapter,
      collections: [],
      auth: {
        roles: ['admin', 'editor'],
        defaultRole: 'editor',
        adminRole: 'admin',
      },
    }

    const app = createLontar(config, {
      ipAddressHeaders: ['x-forwarded-for'],
      rateLimit: {
        enabled: true,
        rules: {
          changePassword: { window: 600, max: 2 },
        },
      },
    })

    const firstUserRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rate-pwd@example.com',
        name: 'Rate User',
        password: 'correct-password-123',
      }),
    })
    const cookie = firstUserRes.headers.get('set-cookie') ?? ''

    const badAttempt = () =>
      app.request('/api/_lontar/me/password', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'x-forwarded-for': '198.51.100.44',
        },
        body: JSON.stringify({
          currentPassword: 'wrong-guess-password',
          newPassword: 'new-password-12345',
        }),
      })

    const r1 = await badAttempt()
    expect(r1.status).toBe(400)
    expect(await r1.json()).toEqual({ error: 'Current password is incorrect' })

    const r2 = await badAttempt()
    expect(r2.status).toBe(400)
    expect(await r2.json()).toEqual({ error: 'Current password is incorrect' })

    const r3 = await badAttempt()
    expect(r3.status).toBe(429)
    expect(r3.headers.get('Retry-After')).toBeDefined()
    expect(Number(r3.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(r3.headers.get('X-Retry-After')).toBeDefined()
    expect(await r3.json()).toEqual({
      error: 'Too many failed password change attempts. Please try again later.',
    })

    const r4 = await app.request('/api/_lontar/me/password', {
      method: 'POST',
      headers: {
        cookie,
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.44',
      },
      body: JSON.stringify({
        currentPassword: 'correct-password-123',
        newPassword: 'new-password-12345',
      }),
    })
    expect(r4.status).toBe(429)

    const otherIpRes = await app.request('/api/_lontar/me/password', {
      method: 'POST',
      headers: {
        cookie,
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.45',
      },
      body: JSON.stringify({
        currentPassword: 'correct-password-123',
        newPassword: 'new-password-12345',
      }),
    })
    expect(otherIpRes.status).toBe(200)
    expect(await otherIpRes.json()).toEqual({ message: 'Password changed successfully' })
  })

  it('valid API keys are never rate limited, even after IP reaches failed key rate limit (#370)', async () => {
    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockDbAdapter,
      collections: [],
      auth: {
        roles: ['admin', 'editor'],
        defaultRole: 'editor',
        adminRole: 'admin',
      },
    }

    const app = createLontar(config, {
      ipAddressHeaders: ['x-forwarded-for'],
      rateLimit: {
        enabled: true,
        rules: {
          apiKeyFailure: { window: 60, max: 2 },
        },
      },
    })

    // Setup user and API key
    const firstUserRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'API User',
        email: 'api-user@example.com',
        password: 'password12345',
      }),
    })
    expect(firstUserRes.status).toBe(200)
    const user = ((await firstUserRes.json()) as { user: { id: string } }).user

    const { key: validRawKey } = await createApiKey(app.auth, {
      userId: user.id,
      name: 'Valid Key',
    })

    const testIp = '198.51.100.99'

    // Fail 2 attempts with invalid key
    const badReq = () =>
      app.request('/api/_lontar/me', {
        headers: {
          authorization: 'Bearer lt_invalidrandomkey12345',
          'x-forwarded-for': testIp,
        },
      })

    const r1 = await badReq()
    expect(r1.status).toBe(401)
    const r2 = await badReq()
    expect(r2.status).toBe(401)

    // 3rd bad key attempt is rate limited (429)
    const r3 = await badReq()
    expect(r3.status).toBe(429)

    // Valid API key from the SAME IP must NOT be blocked (valid keys are never rate limited!)
    const validRes = await app.request('/api/_lontar/me', {
      headers: {
        authorization: `Bearer ${validRawKey}`,
        'x-forwarded-for': testIp,
      },
    })
    expect(validRes.status).toBe(200)
    const validJson = (await validRes.json()) as { user: { email: string } }
    expect(validJson.user.email).toBe('api-user@example.com')
  })

  it('ignores spoofed x-forwarded-for by default when neither trustedProxies nor ipAddressHeaders is configured (#370)', async () => {
    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockDbAdapter,
      collections: [],
    }

    // Default configuration: no ipAddressHeaders or trustedProxies configured
    const app = createLontar(config, {
      rateLimit: {
        enabled: true,
        rules: {
          firstUser: { window: 60, max: 2 },
        },
      },
    })

    // Rotating x-forwarded-for must NOT bypass the limit
    const send = (spoofedIp: string) =>
      app.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': spoofedIp,
        },
        body: JSON.stringify({ email: 'bad' }),
      })

    const r1 = await send('203.0.113.1')
    expect(r1.status).toBe(400)

    const r2 = await send('203.0.113.2')
    expect(r2.status).toBe(400)

    // Attempt 3 with a third spoofed IP is blocked with 429 because untrusted headers were ignored
    const r3 = await send('203.0.113.3')
    expect(r3.status).toBe(429)
  })
})
