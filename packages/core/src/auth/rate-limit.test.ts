import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  getClientIp,
  resolveRateLimitEnabled,
  MemoryRateLimitStorage,
  DatabaseRateLimitStorage,
  RateLimiter,
  type DatabaseAdapterLike,
} from './rate-limit'

describe('rate-limit', () => {
  describe('resolveRateLimitEnabled', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('returns explicit enabled value when specified', () => {
      expect(resolveRateLimitEnabled({ rateLimit: { enabled: true } })).toBe(true)
      expect(resolveRateLimitEnabled({ rateLimit: { enabled: false } })).toBe(false)
    })

    it('returns true when in production and test flags are unset', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.PLAYWRIGHT
      delete process.env.DISABLE_AUTH_RATE_LIMIT
      expect(resolveRateLimitEnabled()).toBe(true)
    })

    it('returns false when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test'
      delete process.env.PLAYWRIGHT
      delete process.env.DISABLE_AUTH_RATE_LIMIT
      expect(resolveRateLimitEnabled()).toBe(false)
    })

    it('returns false when PLAYWRIGHT is true', () => {
      process.env.NODE_ENV = 'production'
      process.env.PLAYWRIGHT = 'true'
      delete process.env.DISABLE_AUTH_RATE_LIMIT
      expect(resolveRateLimitEnabled()).toBe(false)
    })

    it('returns false when DISABLE_AUTH_RATE_LIMIT is true', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.PLAYWRIGHT
      process.env.DISABLE_AUTH_RATE_LIMIT = 'true'
      expect(resolveRateLimitEnabled()).toBe(false)
    })
  })

  describe('getClientIp', () => {
    it('does not trust forwarded headers by default to prevent IP spoofing', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.195' },
      })
      expect(getClientIp(req)).not.toBe('203.0.113.195')
      expect(getClientIp(req)).toBe('127.0.0.1')
    })

    it('extracts IP from x-forwarded-for when header is explicitly configured', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.195' },
      })
      expect(getClientIp(req, { ipAddressHeaders: ['x-forwarded-for'] })).toBe('203.0.113.195')
    })

    it('rejects multi-hop x-forwarded-for without trustedProxies', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' },
      })
      expect(getClientIp(req, { ipAddressHeaders: ['x-forwarded-for'] })).not.toBe('203.0.113.195')
      expect(getClientIp(req, { ipAddressHeaders: ['x-forwarded-for'] })).toBe('127.0.0.1')
    })

    it('walks backwards and strips trusted proxies to find real client IP', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' },
      })
      expect(
        getClientIp(req, {
          ipAddressHeaders: ['x-forwarded-for'],
          trustedProxies: ['150.172.238.178', '70.41.3.18'],
        }),
      ).toBe('203.0.113.195')
    })

    it('stops at untrusted proxy in chain preventing spoofing of leftmost IP', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' },
      })
      // Only 150.172.238.178 is trusted; 70.41.3.18 is untrusted, so 203.0.113.195 cannot be spoofed
      expect(
        getClientIp(req, {
          ipAddressHeaders: ['x-forwarded-for'],
          trustedProxies: ['150.172.238.178'],
        }),
      ).toBe('70.41.3.18')
    })

    it('extracts IP from x-real-ip when configured', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-real-ip': '198.51.100.42' },
      })
      expect(getClientIp(req, { ipAddressHeaders: ['x-real-ip'] })).toBe('198.51.100.42')
    })

    it('extracts IP from cf-connecting-ip when configured', () => {
      const req = new Request('http://localhost', {
        headers: { 'cf-connecting-ip': '192.0.2.1' },
      })
      expect(getClientIp(req, { ipAddressHeaders: ['cf-connecting-ip'] })).toBe('192.0.2.1')
    })

    it('falls back to 127.0.0.1 in test environment when no trusted IP resolved', () => {
      const req = new Request('http://localhost')
      expect(getClientIp(req)).toBe('127.0.0.1')
    })

    it('normalizes IPv6 address canonically', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '2001:db8::1' },
      })
      expect(getClientIp(req, { ipAddressHeaders: ['x-forwarded-for'] })).toBe(
        '2001:0db8:0000:0000:0000:0000:0000:0000',
      )
    })
  })

  describe('MemoryRateLimitStorage', () => {
    it('allows up to max attempts and blocks subsequent ones', async () => {
      const storage = new MemoryRateLimitStorage()
      const rule = { window: 10, max: 2 }

      const r1 = await storage.consume('test-ip', rule)
      expect(r1.allowed).toBe(true)
      expect(r1.retryAfter).toBeNull()

      const r2 = await storage.consume('test-ip', rule)
      expect(r2.allowed).toBe(true)
      expect(r2.retryAfter).toBeNull()

      const r3 = await storage.consume('test-ip', rule)
      expect(r3.allowed).toBe(false)
      expect(r3.retryAfter).toBeGreaterThan(0)
      expect(r3.retryAfter).toBeLessThanOrEqual(10)
    })

    it('isBlocked correctly reports limit state without consuming', async () => {
      const storage = new MemoryRateLimitStorage()
      const rule = { window: 10, max: 2 }

      expect((await storage.isBlocked('test-ip', rule)).allowed).toBe(true)
      await storage.consume('test-ip', rule)
      expect((await storage.isBlocked('test-ip', rule)).allowed).toBe(true)
      await storage.consume('test-ip', rule)
      const blocked = await storage.isBlocked('test-ip', rule)
      expect(blocked.allowed).toBe(false)
      expect(blocked.retryAfter).toBeGreaterThan(0)
    })

    it('resets count after window expires', async () => {
      vi.useFakeTimers()
      const storage = new MemoryRateLimitStorage()
      const rule = { window: 2, max: 1 }

      const r1 = await storage.consume('test-ip', rule)
      expect(r1.allowed).toBe(true)

      const r2 = await storage.consume('test-ip', rule)
      expect(r2.allowed).toBe(false)

      // Advance past window
      vi.advanceTimersByTime(2500)

      const r3 = await storage.consume('test-ip', rule)
      expect(r3.allowed).toBe(true)
      vi.useRealTimers()
    })

    it('caps map size at maxEntries and evicts oldest entries', async () => {
      const storage = new MemoryRateLimitStorage({ maxEntries: 3, pruneIntervalMs: 60_000 })
      const rule = { window: 60, max: 5 }

      await storage.consume('key-1', rule)
      await storage.consume('key-2', rule)
      await storage.consume('key-3', rule)
      expect(storage.size).toBe(3)

      // 4th key exceeds maxEntries=3; key-1 (oldest) should be evicted
      await storage.consume('key-4', rule)
      expect(storage.size).toBe(3)

      // key-1 was evicted, so consuming key-1 starts a fresh counter (allowed: true, not blocked)
      const res1 = await storage.consume('key-1', rule)
      expect(res1.allowed).toBe(true)
      expect(storage.size).toBe(3)
    })

    it('sweeps expired entries when prune interval passes', async () => {
      vi.useFakeTimers()
      const storage = new MemoryRateLimitStorage({ maxEntries: 100, pruneIntervalMs: 1000 })
      const rule = { window: 1, max: 5 }

      await storage.consume('key-1', rule)
      await storage.consume('key-2', rule)
      expect(storage.size).toBe(2)

      // Advance time by 1.5 seconds (past window and prune interval)
      vi.advanceTimersByTime(1500)

      // Consuming next key triggers interval sweep
      await storage.consume('key-3', rule)
      // key-1 and key-2 should have been pruned
      expect(storage.size).toBe(1)
      vi.useRealTimers()
    })
  })

  describe('DatabaseRateLimitStorage', () => {
    it('creates initial row on first consume', async () => {
      const rows: Record<string, unknown>[] = []
      const mockCreate = vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          rows.push(data)
          return Promise.resolve(data)
        })
      const fakeAdapter: DatabaseAdapterLike = {
        findMany: vi.fn().mockResolvedValue(rows),
        create: mockCreate,
        incrementOne: vi.fn().mockResolvedValue(true),
      }

      const storage = new DatabaseRateLimitStorage(() => Promise.resolve(fakeAdapter))
      const res = await storage.consume('db-key', { window: 60, max: 5 })

      expect(res.allowed).toBe(true)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'rateLimit',
        }),
      )
      const createdData = (mockCreate.mock.calls[0]?.[0] as { data?: Record<string, unknown> })
        ?.data
      expect(createdData?.key).toBe('db-key')
      expect(createdData?.count).toBe(1)
    })

    it('increments count on subsequent consume within window', async () => {
      const now = Date.now()
      const existingRow = { id: '1', key: 'db-key', count: 2, lastRequest: now }
      const mockIncrementOne = vi.fn().mockResolvedValue(true)
      const fakeAdapter: DatabaseAdapterLike = {
        findMany: vi.fn().mockResolvedValue([existingRow]),
        create: vi.fn(),
        incrementOne: mockIncrementOne,
      }

      const storage = new DatabaseRateLimitStorage(() => Promise.resolve(fakeAdapter))
      const res = await storage.consume('db-key', { window: 60, max: 5 })

      expect(res.allowed).toBe(true)
      expect(mockIncrementOne).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'rateLimit',
        }),
      )
      const incrementArgs = mockIncrementOne.mock.calls[0]?.[0] as {
        where?: Array<{ field: string; operator?: string; value: unknown }>
      }
      expect(incrementArgs?.where).toEqual(
        expect.arrayContaining([
          { field: 'key', value: 'db-key' },
          { field: 'count', operator: 'lt', value: 5 },
        ]),
      )
    })

    it('blocks request when incrementOne returns false due to limit reached', async () => {
      const now = Date.now()
      const existingRow = { id: '1', key: 'db-key', count: 5, lastRequest: now }
      const fakeAdapter: DatabaseAdapterLike = {
        findMany: vi.fn().mockResolvedValue([existingRow]),
        create: vi.fn(),
        incrementOne: vi.fn().mockResolvedValue(false),
      }

      const storage = new DatabaseRateLimitStorage(() => Promise.resolve(fakeAdapter))
      const res = await storage.consume('db-key', { window: 60, max: 5 })

      expect(res.allowed).toBe(false)
      expect(res.retryAfter).toBeGreaterThan(0)
    })

    it('resets count when window has elapsed', async () => {
      const oldTime = Date.now() - 70000 // 70s ago, window 60s
      const existingRow = { id: '1', key: 'db-key', count: 5, lastRequest: oldTime }
      const mockIncrementOne = vi.fn().mockResolvedValue(true)
      const fakeAdapter: DatabaseAdapterLike = {
        findMany: vi.fn().mockResolvedValue([existingRow]),
        create: vi.fn(),
        incrementOne: mockIncrementOne,
      }

      const storage = new DatabaseRateLimitStorage(() => Promise.resolve(fakeAdapter))
      const res = await storage.consume('db-key', { window: 60, max: 5 })

      expect(res.allowed).toBe(true)
      expect(mockIncrementOne).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'rateLimit',
        }),
      )
      const incrementArgs = mockIncrementOne.mock.calls[0]?.[0] as {
        set?: Record<string, unknown>
      }
      expect(incrementArgs?.set?.count).toBe(1)
    })

    it('isBlocked correctly checks db row without incrementing', async () => {
      const now = Date.now()
      const fakeAdapter: DatabaseAdapterLike = {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: '1', key: 'db-key', count: 5, lastRequest: now }]),
        create: vi.fn(),
        incrementOne: vi.fn(),
      }

      const storage = new DatabaseRateLimitStorage(() => Promise.resolve(fakeAdapter))
      const res1 = await storage.isBlocked('db-key', { window: 60, max: 5 })
      expect(res1.allowed).toBe(true)

      const res2 = await storage.isBlocked('db-key', { window: 60, max: 5 })
      expect(res2.allowed).toBe(false)
      expect(res2.retryAfter).toBeGreaterThan(0)
    })

    it('returns allowed: true instead of hanging when adapter.create always throws', async () => {
      const mockFindMany = vi.fn().mockResolvedValue([])
      const mockCreate = vi.fn().mockRejectedValue(new Error('DB connection failed'))
      const fakeAdapter: DatabaseAdapterLike = {
        findMany: mockFindMany,
        create: mockCreate,
        incrementOne: vi.fn(),
      }

      const storage = new DatabaseRateLimitStorage(() => Promise.resolve(fakeAdapter))
      const res = await storage.consume('test-key', { window: 60, max: 5 })

      expect(res.allowed).toBe(true)
      expect(res.retryAfter).toBeNull()
      // findMany should be called at most twice (initial check + 1 re-read on failed create)
      expect(mockFindMany).toHaveBeenCalledTimes(2)
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it('returns allowed: true instead of hanging when key is longer than column', async () => {
      const mockFindMany = vi.fn().mockResolvedValue([])
      const fakeAdapter: DatabaseAdapterLike = {
        findMany: mockFindMany,
        create: vi.fn().mockImplementation(({ data }: { data: { key?: string } }) => {
          if (data.key && data.key.length > 255) {
            return Promise.reject(new Error('ER_DATA_TOO_LONG: Data too long for column key'))
          }
          return Promise.resolve(data)
        }),
        incrementOne: vi.fn(),
      }

      const storage = new DatabaseRateLimitStorage(() => Promise.resolve(fakeAdapter))
      const longKey = 'a'.repeat(300)
      const res = await storage.consume(longKey, { window: 60, max: 5 })

      expect(res.allowed).toBe(true)
      expect(res.retryAfter).toBeNull()
      expect(mockFindMany).toHaveBeenCalledTimes(2)
    })

    it('recovers without infinite recursion when a concurrent insert creates the row', async () => {
      const now = Date.now()
      const concurrentRow = { id: 'c1', key: 'db-key', count: 1, lastRequest: now }
      const mockIncrementOne = vi.fn().mockResolvedValue(true)
      const fakeAdapter: DatabaseAdapterLike = {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([]) // First read: empty
          .mockResolvedValueOnce([concurrentRow]) // Re-read after create conflict: row exists
          .mockResolvedValueOnce([concurrentRow]), // Recursive attempt: row exists
        create: vi.fn().mockRejectedValue(new Error('ER_DUP_ENTRY: Duplicate entry for key')),
        incrementOne: mockIncrementOne,
      }

      const storage = new DatabaseRateLimitStorage(() => Promise.resolve(fakeAdapter))
      const res = await storage.consume('db-key', { window: 60, max: 5 })

      expect(res.allowed).toBe(true)
      expect(mockIncrementOne).toHaveBeenCalled()
    })
  })

  describe('RateLimiter', () => {
    it('returns allowed: true always when disabled', async () => {
      const limiter = new RateLimiter({ enabled: false })
      for (let i = 0; i < 10; i++) {
        const res = await limiter.consume('key', { window: 10, max: 1 })
        expect(res.allowed).toBe(true)
      }
    })

    it('enforces limit when enabled: true', async () => {
      const limiter = new RateLimiter({ enabled: true })
      const rule = { window: 10, max: 2 }

      expect((await limiter.consume('k1', rule)).allowed).toBe(true)
      expect((await limiter.consume('k1', rule)).allowed).toBe(true)
      const blocked = await limiter.consume('k1', rule)
      expect(blocked.allowed).toBe(false)
      expect(blocked.retryAfter).toBeGreaterThan(0)
    })

    it('supports custom storage', async () => {
      const consumeSpy = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 42 })
      const customStorage = {
        consume: consumeSpy,
      }
      const limiter = new RateLimiter({ enabled: true, customStorage })
      const res = await limiter.consume('k', { window: 10, max: 1 })

      expect(res.allowed).toBe(false)
      expect(res.retryAfter).toBe(42)
      expect(consumeSpy).toHaveBeenCalledWith('k', { window: 10, max: 1 })
    })

    it('tracks failed API key attempts and blocks after reaching threshold', async () => {
      const limiter = new RateLimiter({
        enabled: true,
        rules: { apiKeyFailure: { window: 60, max: 3 } },
      })
      const ip = '10.0.0.1'

      // Initially not blocked
      expect((await limiter.checkApiKeyFailureLimit(ip)).allowed).toBe(true)

      // 3 failed attempts recorded
      expect((await limiter.recordApiKeyFailure(ip)).allowed).toBe(true)
      expect((await limiter.recordApiKeyFailure(ip)).allowed).toBe(true)
      expect((await limiter.recordApiKeyFailure(ip)).allowed).toBe(true)

      // Check is now blocked
      const checkBlocked = await limiter.checkApiKeyFailureLimit(ip)
      expect(checkBlocked.allowed).toBe(false)
      expect(checkBlocked.retryAfter).toBeGreaterThan(0)

      // Subsequent record is also blocked
      const recordBlocked = await limiter.recordApiKeyFailure(ip)
      expect(recordBlocked.allowed).toBe(false)
      expect(recordBlocked.retryAfter).toBeGreaterThan(0)
    })

    it('tracks change-password failures and blocks after reaching threshold (#371)', async () => {
      const limiter = new RateLimiter({
        enabled: true,
        rules: { changePassword: { window: 600, max: 2 } },
      })
      const userId = 'user-123'
      const ip = '192.168.1.50'

      expect((await limiter.checkChangePasswordLimit(userId, ip)).allowed).toBe(true)

      // First failure
      expect((await limiter.recordChangePasswordFailure(userId, ip)).allowed).toBe(true)
      expect((await limiter.checkChangePasswordLimit(userId, ip)).allowed).toBe(true)

      // Second failure hits limit (max: 2)
      expect((await limiter.recordChangePasswordFailure(userId, ip)).allowed).toBe(true)

      // Now blocked
      const checkBlocked = await limiter.checkChangePasswordLimit(userId, ip)
      expect(checkBlocked.allowed).toBe(false)
      expect(checkBlocked.retryAfter).toBeGreaterThan(0)

      const recordBlocked = await limiter.recordChangePasswordFailure(userId, ip)
      expect(recordBlocked.allowed).toBe(false)
      expect(recordBlocked.retryAfter).toBeGreaterThan(0)
    })
  })
})
