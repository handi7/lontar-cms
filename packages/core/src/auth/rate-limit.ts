import { randomBytes } from 'node:crypto'

export interface RateLimitRule {
  /**
   * Time window in seconds.
   */
  window: number
  /**
   * Maximum allowed attempts within the window.
   */
  max: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfter: number | null
}

export interface RateLimitStorage {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>
  isBlocked?(key: string, rule: RateLimitRule): Promise<RateLimitResult>
}

interface MemoryEntry {
  count: number
  lastRequest: number
  expiresAt: number
}

export class MemoryRateLimitStorage implements RateLimitStorage {
  private entries = new Map<string, MemoryEntry>()

  private prune(now: number): void {
    if (this.entries.size > 500) {
      for (const [key, entry] of this.entries.entries()) {
        if (now >= entry.expiresAt) {
          this.entries.delete(key)
        }
      }
    }
  }

  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = Date.now()
    this.prune(now)
    const windowInMs = rule.window * 1000
    const entry = this.entries.get(key)

    if (!entry || now >= entry.expiresAt) {
      this.entries.set(key, {
        count: 1,
        lastRequest: now,
        expiresAt: now + windowInMs,
      })
      return Promise.resolve({ allowed: true, retryAfter: null })
    }

    if (entry.count < rule.max) {
      entry.count += 1
      entry.lastRequest = now
      return Promise.resolve({ allowed: true, retryAfter: null })
    }

    const retryAfter = Math.max(1, Math.ceil((entry.expiresAt - now) / 1000))
    return Promise.resolve({ allowed: false, retryAfter })
  }

  isBlocked(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = Date.now()
    const entry = this.entries.get(key)
    if (!entry || now >= entry.expiresAt) {
      return Promise.resolve({ allowed: true, retryAfter: null })
    }
    if (entry.count >= rule.max) {
      const retryAfter = Math.max(1, Math.ceil((entry.expiresAt - now) / 1000))
      return Promise.resolve({ allowed: false, retryAfter })
    }
    return Promise.resolve({ allowed: true, retryAfter: null })
  }

  clear(): void {
    this.entries.clear()
  }
}

export interface DatabaseAdapterLike {
  findMany(args: {
    model: string
    where: Array<{ field: string; value: unknown; operator?: string }>
  }): Promise<
    Array<{ id?: string; key?: string; count?: number; lastRequest?: number | string | bigint }>
  >
  create(args: { model: string; data: Record<string, unknown> }): Promise<unknown>
  incrementOne(args: {
    model: string
    where: Array<{ field: string; value: unknown; operator?: string }>
    increment: Record<string, number>
    set?: Record<string, unknown>
  }): Promise<unknown>
  deleteMany?(args: {
    model: string
    where: Array<{ field: string; value: unknown; operator?: string }>
  }): Promise<unknown>
}

export class DatabaseRateLimitStorage implements RateLimitStorage {
  constructor(private getAdapter: () => Promise<DatabaseAdapterLike | null>) {}

  private async createInitialRow(
    adapter: DatabaseAdapterLike,
    key: string,
    now: number,
  ): Promise<boolean> {
    try {
      await adapter.create({
        model: 'rateLimit',
        data: {
          id: randomBytes(16).toString('hex'),
          key,
          count: 1,
          lastRequest: now,
        },
      })
      return true
    } catch {
      return false
    }
  }

  private async resetExpiredWindow(
    adapter: DatabaseAdapterLike,
    key: string,
    lastRequest: number,
    now: number,
  ): Promise<boolean> {
    const updated = await adapter.incrementOne({
      model: 'rateLimit',
      where: [
        { field: 'key', value: key },
        { field: 'lastRequest', operator: 'lte', value: lastRequest },
      ],
      increment: {},
      set: { count: 1, lastRequest: now },
    })
    return Boolean(updated)
  }

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const adapter = await this.getAdapter()
    if (!adapter) {
      return { allowed: true, retryAfter: null }
    }

    const model = 'rateLimit'
    const now = Date.now()
    const windowInMs = rule.window * 1000

    const rows = await adapter.findMany({
      model,
      where: [{ field: 'key', value: key }],
    })
    const existing = rows[0]

    if (!existing) {
      const created = await this.createInitialRow(adapter, key, now)
      if (created) {
        return { allowed: true, retryAfter: null }
      }
      return this.consume(key, rule)
    }

    const lastRequest = Number(existing.lastRequest)
    if (now - lastRequest >= windowInMs) {
      const reset = await this.resetExpiredWindow(adapter, key, lastRequest, now)
      if (reset) {
        return { allowed: true, retryAfter: null }
      }
      return this.consume(key, rule)
    }

    const windowStart = now - windowInMs
    const updated = await adapter.incrementOne({
      model,
      where: [
        { field: 'key', value: key },
        { field: 'lastRequest', operator: 'gt', value: windowStart },
        { field: 'count', operator: 'lt', value: rule.max },
      ],
      increment: { count: 1 },
      set: { lastRequest: now },
    })
    if (updated) {
      return { allowed: true, retryAfter: null }
    }

    const retryAfter = Math.max(1, Math.ceil((lastRequest + windowInMs - now) / 1000))
    return { allowed: false, retryAfter }
  }

  async isBlocked(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const adapter = await this.getAdapter()
    if (!adapter) {
      return { allowed: true, retryAfter: null }
    }

    const model = 'rateLimit'
    const now = Date.now()
    const windowInMs = rule.window * 1000

    const rows = await adapter.findMany({
      model,
      where: [{ field: 'key', value: key }],
    })
    const existing = rows[0]

    if (!existing) {
      return { allowed: true, retryAfter: null }
    }

    const lastRequest = Number(existing.lastRequest)
    const count = Number(existing.count ?? 0)

    if (now - lastRequest < windowInMs && count >= rule.max) {
      const retryAfter = Math.max(1, Math.ceil((lastRequest + windowInMs - now) / 1000))
      return { allowed: false, retryAfter }
    }

    return { allowed: true, retryAfter: null }
  }
}

export interface RateLimitOptions {
  enabled?: boolean
  window?: number
  max?: number
  storage?: 'memory' | 'database' | 'secondary-storage'
  customStorage?: RateLimitStorage
  customRules?: Record<
    string,
    | RateLimitRule
    | false
    | ((
        request: Request,
        currentRule: RateLimitRule,
      ) => RateLimitRule | false | Promise<RateLimitRule | false>)
  >
  rules?: {
    firstUser?: RateLimitRule
    invite?: RateLimitRule
    apiKeyFailure?: RateLimitRule
  }
}

export function resolveRateLimitEnabled(options?: { rateLimit?: { enabled?: boolean } }): boolean {
  if (options?.rateLimit?.enabled !== undefined) {
    return options.rateLimit.enabled
  }
  return (
    process.env.NODE_ENV !== 'test' &&
    process.env.PLAYWRIGHT !== 'true' &&
    process.env.DISABLE_AUTH_RATE_LIMIT !== 'true'
  )
}

export function getClientIp(req: Request): string {
  const xForwardedFor = req.headers.get('x-forwarded-for')
  if (xForwardedFor) {
    const first = xForwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  const xRealIp = req.headers.get('x-real-ip')
  if (xRealIp) return xRealIp.trim()
  const cfConnectingIp = req.headers.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp.trim()
  return '127.0.0.1'
}

function resolveRateLimitRules(options?: RateLimitOptions) {
  return {
    firstUser: options?.rules?.firstUser ?? { window: 60, max: 5 },
    invite: options?.rules?.invite ?? { window: 60, max: 10 },
    apiKeyFailure: options?.rules?.apiKeyFailure ?? { window: 60, max: 5 },
  }
}

function resolveRateLimitStorage(
  options: RateLimitOptions,
  getAdapter?: () => Promise<DatabaseAdapterLike | null>,
): RateLimitStorage {
  if (options.customStorage) {
    return options.customStorage
  }
  if (options.storage === 'database' && getAdapter) {
    return new DatabaseRateLimitStorage(getAdapter)
  }
  return new MemoryRateLimitStorage()
}

export class RateLimiter {
  readonly enabled: boolean
  readonly storage: RateLimitStorage
  readonly rules: {
    firstUser: RateLimitRule
    invite: RateLimitRule
    apiKeyFailure: RateLimitRule
  }

  constructor(
    options: RateLimitOptions = {},
    getAdapter?: () => Promise<DatabaseAdapterLike | null>,
  ) {
    this.enabled = resolveRateLimitEnabled({ rateLimit: options })
    this.rules = resolveRateLimitRules(options)
    this.storage = resolveRateLimitStorage(options, getAdapter)
  }

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    if (!this.enabled) {
      return { allowed: true, retryAfter: null }
    }
    return this.storage.consume(key, rule)
  }

  async isBlocked(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    if (!this.enabled) {
      return { allowed: true, retryAfter: null }
    }
    if (this.storage.isBlocked) {
      return this.storage.isBlocked(key, rule)
    }
    return { allowed: true, retryAfter: null }
  }

  async checkApiKeyFailureLimit(ip: string): Promise<RateLimitResult> {
    return this.isBlocked(`api-key-failure:${ip}`, this.rules.apiKeyFailure)
  }

  async recordApiKeyFailure(ip: string): Promise<RateLimitResult> {
    return this.consume(`api-key-failure:${ip}`, this.rules.apiKeyFailure)
  }
}
