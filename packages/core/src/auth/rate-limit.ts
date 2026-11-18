import { randomBytes } from 'node:crypto'
import { getIP } from 'better-auth/api'

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

export const MEMORY_RATE_LIMIT_MAX_ENTRIES = 100_000
export const MEMORY_RATE_LIMIT_PRUNE_INTERVAL_MS = 60_000

export class MemoryRateLimitStorage implements RateLimitStorage {
  private entries = new Map<string, MemoryEntry>()
  private lastPrune = 0
  private readonly maxEntries: number
  private readonly pruneIntervalMs: number

  constructor(options?: { maxEntries?: number; pruneIntervalMs?: number }) {
    this.maxEntries = options?.maxEntries ?? MEMORY_RATE_LIMIT_MAX_ENTRIES
    this.pruneIntervalMs = options?.pruneIntervalMs ?? MEMORY_RATE_LIMIT_PRUNE_INTERVAL_MS
  }

  get size(): number {
    return this.entries.size
  }

  private prune(now: number): void {
    if (now - this.lastPrune < this.pruneIntervalMs && this.entries.size <= this.maxEntries) {
      return
    }
    this.lastPrune = now

    for (const [key, entry] of this.entries.entries()) {
      if (now >= entry.expiresAt) {
        this.entries.delete(key)
      }
    }

    if (this.entries.size > this.maxEntries) {
      const overflow = this.entries.size - this.maxEntries
      let removed = 0
      for (const key of this.entries.keys()) {
        this.entries.delete(key)
        removed += 1
        if (removed >= overflow) break
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
      if (this.entries.size > this.maxEntries) {
        this.prune(now)
      }
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
    this.lastPrune = 0
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

  private async handleMissingRow(
    adapter: DatabaseAdapterLike,
    key: string,
    rule: RateLimitRule,
    now: number,
    attempt: number,
  ): Promise<RateLimitResult> {
    const created = await this.createInitialRow(adapter, key, now)
    if (created) {
      return { allowed: true, retryAfter: null }
    }

    try {
      const retryRows = await adapter.findMany({
        model: 'rateLimit',
        where: [{ field: 'key', value: key }],
      })
      if (!retryRows[0]) {
        console.warn(`[rate-limit] Failed to create rate limit row for key "${key}"; failing open.`)
        return { allowed: true, retryAfter: null }
      }
    } catch (err) {
      console.warn(`[rate-limit] Error checking rate limit row for key "${key}":`, err)
      return { allowed: true, retryAfter: null }
    }

    return this.consume(key, rule, attempt + 1)
  }

  async consume(key: string, rule: RateLimitRule, attempt = 0): Promise<RateLimitResult> {
    if (attempt > 1) {
      console.warn(`[rate-limit] Exceeded retry attempts for key "${key}"; failing open.`)
      return { allowed: true, retryAfter: null }
    }

    const adapter = await this.getAdapter()
    if (!adapter) {
      return { allowed: true, retryAfter: null }
    }

    const model = 'rateLimit'
    const now = Date.now()
    const windowInMs = rule.window * 1000

    let rows: Array<{
      id?: string
      key?: string
      count?: number
      lastRequest?: number | string | bigint
    }>
    try {
      rows = await adapter.findMany({
        model,
        where: [{ field: 'key', value: key }],
      })
    } catch (err) {
      console.warn(`[rate-limit] Failed to query rate limit for key "${key}":`, err)
      return { allowed: true, retryAfter: null }
    }

    const existing = rows[0]
    if (!existing) {
      return this.handleMissingRow(adapter, key, rule, now, attempt)
    }

    const lastRequest = Number(existing.lastRequest)
    if (now - lastRequest >= windowInMs) {
      const reset = await this.resetExpiredWindow(adapter, key, lastRequest, now)
      if (reset) {
        return { allowed: true, retryAfter: null }
      }
      return this.consume(key, rule, attempt + 1)
    }

    const windowStart = now - windowInMs
    try {
      const updated = await adapter.incrementOne({
        model,
        where: [
          { field: 'key', value: key },
          { field: 'lastRequest', operator: 'gt', value: windowStart },
          { field: 'count', operator: 'lt', value: rule.max },
        ],
        increment: { count: 1 },
      })
      if (updated) {
        return { allowed: true, retryAfter: null }
      }
    } catch (err) {
      console.warn(`[rate-limit] Failed to increment rate limit for key "${key}":`, err)
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

    try {
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
    } catch {
      return { allowed: true, retryAfter: null }
    }
  }
}

export interface RateLimitOptions {
  enabled?: boolean
  window?: number
  max?: number
  storage?: 'memory' | 'database'
  customStorage?: RateLimitStorage
  trustedProxies?: string[]
  ipAddressHeaders?: string[]
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
    changePassword?: RateLimitRule
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

export interface IpResolutionOptions {
  ipAddressHeaders?: string[]
  trustedProxies?: string[]
}

function parseListEnv(val?: string): string[] | undefined {
  if (!val) return undefined
  const items = val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

export function resolveIpResolutionOptions(options?: IpResolutionOptions): {
  ipAddressHeaders: string[]
  trustedProxies?: string[]
} {
  const envTrustedProxies = parseListEnv(process.env.TRUSTED_PROXIES)
  const envHeaders = parseListEnv(process.env.IP_ADDRESS_HEADERS)

  const trustedProxies = options?.trustedProxies ?? envTrustedProxies
  const configuredHeaders = options?.ipAddressHeaders ?? envHeaders

  if (configuredHeaders) {
    return {
      ipAddressHeaders: configuredHeaders,
      ...(trustedProxies ? { trustedProxies } : {}),
    }
  }

  if (trustedProxies && trustedProxies.length > 0) {
    return {
      ipAddressHeaders: ['x-forwarded-for'],
      trustedProxies,
    }
  }

  return {
    ipAddressHeaders: [],
  }
}

export function getClientIp(req: Request, options?: IpResolutionOptions): string {
  const resolved = resolveIpResolutionOptions(options)
  const ip = getIP(req, {
    advanced: {
      ipAddress: {
        ipAddressHeaders: resolved.ipAddressHeaders,
        ...(resolved.trustedProxies ? { trustedProxies: resolved.trustedProxies } : {}),
      },
    },
  })
  return ip ?? 'no-trusted-ip'
}

const DEFAULT_RATE_LIMIT_RULES = {
  firstUser: { window: 60, max: 5 },
  invite: { window: 60, max: 10 },
  apiKeyFailure: { window: 60, max: 5 },
  changePassword: { window: 600, max: 5 },
} as const

function resolveRateLimitRules(options?: RateLimitOptions) {
  const rules = options?.rules
  if (!rules) return { ...DEFAULT_RATE_LIMIT_RULES }
  return {
    firstUser: rules.firstUser ?? DEFAULT_RATE_LIMIT_RULES.firstUser,
    invite: rules.invite ?? DEFAULT_RATE_LIMIT_RULES.invite,
    apiKeyFailure: rules.apiKeyFailure ?? DEFAULT_RATE_LIMIT_RULES.apiKeyFailure,
    changePassword: rules.changePassword ?? DEFAULT_RATE_LIMIT_RULES.changePassword,
  }
}

function validateRateLimitStorage(storage?: string): void {
  if (storage && storage !== 'memory' && storage !== 'database') {
    throw new Error(
      `Invalid rateLimit.storage "${String(storage)}". Supported storage options are "memory" or "database" (or provide customStorage).`,
    )
  }
}

function resolveRateLimitStorage(
  options: RateLimitOptions,
  getAdapter?: () => Promise<DatabaseAdapterLike | null>,
): RateLimitStorage {
  if (options.customStorage) {
    return options.customStorage
  }
  validateRateLimitStorage(options.storage)
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
    changePassword: RateLimitRule
  }
  readonly ipResolution: {
    ipAddressHeaders: string[]
    trustedProxies?: string[]
  }

  constructor(
    options: RateLimitOptions = {},
    getAdapter?: () => Promise<DatabaseAdapterLike | null>,
  ) {
    this.enabled = resolveRateLimitEnabled({ rateLimit: options })
    this.rules = resolveRateLimitRules(options)
    this.storage = resolveRateLimitStorage(options, getAdapter)
    this.ipResolution = resolveIpResolutionOptions(options)
  }

  getClientIp(req: Request): string {
    return getClientIp(req, this.ipResolution)
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

  async checkChangePasswordLimit(userId: string, ip: string): Promise<RateLimitResult> {
    return this.isBlocked(`change-password:${userId}:${ip}`, this.rules.changePassword)
  }

  async recordChangePasswordFailure(userId: string, ip: string): Promise<RateLimitResult> {
    return this.consume(`change-password:${userId}:${ip}`, this.rules.changePassword)
  }
}
