import { createHash, randomBytes } from 'node:crypto'
import type { Auth, AuthUser } from './types'
import { cleanUser } from './user'

export interface ApiKeyItem {
  id: string
  name: string
  start: string
  userId: string
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}

export interface CreatedApiKeyResult extends ApiKeyItem {
  key: string
}

export interface CreateApiKeyOptions {
  userId: string
  name: string
  expiresIn?: number | null
}

export interface VerifyApiKeyResult {
  valid: boolean
  error?: string
  user?: AuthUser
  apiKey?: ApiKeyItem
}

export function apiKeyPlugin() {
  return {
    id: 'lontar-api-key',
    schema: {
      apikey: {
        fields: {
          name: { type: 'string' as const, required: true },
          start: { type: 'string' as const, required: true },
          key: { type: 'string' as const, required: true },
          userId: {
            type: 'string' as const,
            required: true,
            references: { model: 'user', field: 'id' },
          },
          expiresAt: { type: 'date' as const, required: false },
          lastUsedAt: { type: 'date' as const, required: false },
          createdAt: { type: 'date' as const, required: false },
          updatedAt: { type: 'date' as const, required: false },
        },
      },
    },
  }
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

export function generateRawApiKey(): { rawKey: string; start: string } {
  const token = randomBytes(32).toString('hex')
  const rawKey = `lt_${token}`
  const start = `lt_${token.slice(0, 6)}...`
  return { rawKey, start }
}

function parseStringProp(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback
}

function parseDate(val: unknown): Date | null {
  if (!val) return null
  if (val instanceof Date) return val
  if (typeof val === 'string' || typeof val === 'number') return new Date(val)
  return null
}

export function cleanApiKey(raw: unknown): ApiKeyItem {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    id: parseStringProp(r.id),
    name: parseStringProp(r.name),
    start: parseStringProp(r.start),
    userId: parseStringProp(r.userId),
    expiresAt: parseDate(r.expiresAt),
    lastUsedAt: parseDate(r.lastUsedAt),
    createdAt: parseDate(r.createdAt) ?? new Date(),
  }
}

function calculateExpiresAt(expiresIn?: number | null): Date | null {
  if (expiresIn === undefined || expiresIn === null || expiresIn <= 0) {
    return null
  }
  return new Date(Date.now() + expiresIn * 1000)
}

export async function createApiKey(
  auth: Auth,
  options: CreateApiKeyOptions,
): Promise<CreatedApiKeyResult> {
  const { rawKey, start } = generateRawApiKey()
  const hashed = hashApiKey(rawKey)
  const expiresAt = calculateExpiresAt(options.expiresIn)
  const now = new Date()

  const ctx = await auth.$context
  const created = await ctx.adapter.create({
    model: 'apikey',
    data: {
      name: options.name.trim(),
      start,
      key: hashed,
      userId: options.userId,
      ...(expiresAt ? { expiresAt } : {}),
      createdAt: now,
      updatedAt: now,
    },
  })

  return {
    ...cleanApiKey(created),
    key: rawKey,
  }
}

function isKeyExpired(expiresAt: Date | null): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now())
}

function isUserBanned(user: { banned?: boolean; banExpires?: Date | string | null }): boolean {
  if (!user.banned) return false
  if (!user.banExpires) return true
  return new Date(user.banExpires).getTime() > Date.now()
}

export async function verifyApiKey(auth: Auth, rawKey: string): Promise<VerifyApiKeyResult> {
  if (!rawKey || typeof rawKey !== 'string') {
    return { valid: false, error: 'Invalid API key' }
  }

  const hashed = hashApiKey(rawKey)
  const ctx = await auth.$context

  const record = await ctx.adapter.findOne({
    model: 'apikey',
    where: [{ field: 'key', value: hashed }],
  })

  if (!record) {
    return { valid: false, error: 'Invalid API key' }
  }

  const keyItem = cleanApiKey(record)
  if (isKeyExpired(keyItem.expiresAt)) {
    return { valid: false, error: 'API key has expired' }
  }

  const userRecord = await ctx.internalAdapter.findUserById(keyItem.userId)
  if (!userRecord) {
    return { valid: false, error: 'User not found' }
  }

  const user = cleanUser(userRecord)
  if (isUserBanned(user)) {
    return { valid: false, error: 'User account is disabled' }
  }

  // Update lastUsedAt asynchronously
  void ctx.adapter.update({
    model: 'apikey',
    where: [{ field: 'id', value: keyItem.id }],
    update: { lastUsedAt: new Date() },
  })

  return {
    valid: true,
    user: user as unknown as AuthUser,
    apiKey: keyItem,
  }
}

export async function listApiKeys(auth: Auth, userId?: string): Promise<ApiKeyItem[]> {
  const ctx = await auth.$context
  const records = await ctx.adapter.findMany({
    model: 'apikey',
    where: userId ? [{ field: 'userId', value: userId }] : undefined,
    sortBy: { field: 'createdAt', direction: 'desc' },
  })

  return (records ?? []).map(cleanApiKey)
}

export async function getApiKeyById(auth: Auth, id: string): Promise<ApiKeyItem | null> {
  const ctx = await auth.$context
  const record = await ctx.adapter.findOne({
    model: 'apikey',
    where: [{ field: 'id', value: id }],
  })

  return record ? cleanApiKey(record) : null
}

export async function revokeApiKey(
  auth: Auth,
  id: string,
  requestingUser: AuthUser,
  adminRole = 'admin',
): Promise<boolean> {
  const ctx = await auth.$context
  const record = await ctx.adapter.findOne<{ userId?: string }>({
    model: 'apikey',
    where: [{ field: 'id', value: id }],
  })

  if (!record) {
    return false
  }

  const isOwner = record.userId === requestingUser.id
  const isAdmin = requestingUser.role === adminRole

  if (!isOwner && !isAdmin) {
    throw new Error('Forbidden: you do not have permission to revoke this API key')
  }

  await ctx.adapter.delete({
    model: 'apikey',
    where: [{ field: 'id', value: id }],
  })

  return true
}
