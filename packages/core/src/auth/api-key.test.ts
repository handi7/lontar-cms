import { describe, expect, it, vi } from 'vitest'
import {
  calculateExpiresAt,
  createApiKey,
  generateRawApiKey,
  hashApiKey,
  listApiKeys,
  MAX_TIMESTAMP_MS,
  revokeApiKey,
  verifyApiKey,
} from './api-key'
import type { Auth, AuthUser } from './types'

describe('API keys service (#345)', () => {
  it('generateRawApiKey generates prefixed tokens and start preview', () => {
    const { rawKey, start } = generateRawApiKey()
    expect(rawKey.startsWith('lt_')).toBe(true)
    expect(rawKey.length).toBe(67) // 'lt_' (3) + 64 hex chars
    expect(start.startsWith('lt_')).toBe(true)
    expect(start.endsWith('...')).toBe(true)
  })

  it('hashApiKey generates consistent sha256 hex string', () => {
    const hash1 = hashApiKey('lt_test123')
    const hash2 = hashApiKey('lt_test123')
    const hash3 = hashApiKey('lt_different')
    expect(hash1).toBe(hash2)
    expect(hash1).not.toBe(hash3)
    expect(hash1.length).toBe(64)
  })

  it('createApiKey hashes key and stores record in adapter', async () => {
    const mockCreated: Record<string, unknown> = {
      id: 'key-1',
      name: 'CI Integration',
      start: 'lt_123456...',
      userId: 'user-1',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    }

    const adapterCreate = vi.fn().mockResolvedValue(mockCreated)
    const mockAuth = {
      $context: Promise.resolve({
        adapter: { create: adapterCreate },
      }),
    } as unknown as Auth

    const result = await createApiKey(mockAuth, {
      userId: 'user-1',
      name: 'CI Integration',
    })

    expect(result.id).toBe('key-1')
    expect(result.name).toBe('CI Integration')
    expect(result.key.startsWith('lt_')).toBe(true)
    expect(adapterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'apikey',
      }),
    )
    const createArgs = adapterCreate.mock.calls[0]?.[0] as {
      model: string
      data: { userId: string; name: string; key: string }
    }
    expect(createArgs.data.userId).toBe('user-1')
    expect(createArgs.data.name).toBe('CI Integration')
    expect(typeof createArgs.data.key).toBe('string')
  })

  it('verifyApiKey validates active key and updates lastUsedAt', async () => {
    const rawKey = 'lt_validkey123456'
    const hashed = hashApiKey(rawKey)

    const mockKeyRecord: Record<string, unknown> = {
      id: 'key-1',
      name: 'Prod Script',
      start: 'lt_valid...',
      userId: 'user-1',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    }

    const mockUserRecord = {
      id: 'user-1',
      name: 'Bob',
      email: 'bob@example.com',
      role: 'editor',
      banned: false,
    }

    const adapterFindOne = vi
      .fn()
      .mockImplementation(
        (args: { model: string; where: Array<{ field: string; value: unknown }> }) => {
          if (args.model === 'apikey' && args.where[0]?.value === hashed) {
            return Promise.resolve(mockKeyRecord)
          }
          return Promise.resolve(null)
        },
      )

    const adapterUpdate = vi.fn().mockResolvedValue({})
    const internalFindUserById = vi.fn().mockResolvedValue(mockUserRecord)

    const mockAuth = {
      $context: Promise.resolve({
        adapter: {
          findOne: adapterFindOne,
          update: adapterUpdate,
        },
        internalAdapter: {
          findUserById: internalFindUserById,
        },
      }),
    } as unknown as Auth

    const res = await verifyApiKey(mockAuth, rawKey)

    expect(res.valid).toBe(true)
    expect(res.user?.id).toBe('user-1')
    expect(res.user?.email).toBe('bob@example.com')
    expect(adapterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'apikey',
        where: [{ field: 'id', value: 'key-1' }],
      }),
    )
    const updateArgs = adapterUpdate.mock.calls[0]?.[0] as {
      update: { lastUsedAt: Date }
    }
    expect(updateArgs.update.lastUsedAt).toBeInstanceOf(Date)
  })

  it('verifyApiKey rejects invalid key token', async () => {
    const adapterFindOne = vi.fn().mockResolvedValue(null)
    const mockAuth = {
      $context: Promise.resolve({
        adapter: { findOne: adapterFindOne },
      }),
    } as unknown as Auth

    const res = await verifyApiKey(mockAuth, 'lt_unknown')
    expect(res.valid).toBe(false)
    expect(res.error).toBe('Invalid API key')
  })

  it('verifyApiKey rejects expired key token', async () => {
    const rawKey = 'lt_expiredkey123'

    const mockKeyRecord: Record<string, unknown> = {
      id: 'key-expired',
      name: 'Old Key',
      start: 'lt_expir...',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 10000), // in the past
      createdAt: new Date(),
    }

    const adapterFindOne = vi.fn().mockResolvedValue(mockKeyRecord)
    const mockAuth = {
      $context: Promise.resolve({
        adapter: { findOne: adapterFindOne },
      }),
    } as unknown as Auth

    const res = await verifyApiKey(mockAuth, rawKey)
    expect(res.valid).toBe(false)
    expect(res.error).toBe('API key has expired')
  })

  it('verifyApiKey rejects keys owned by banned user', async () => {
    const rawKey = 'lt_banneduserkey'

    const mockKeyRecord: Record<string, unknown> = {
      id: 'key-2',
      name: 'Bad Key',
      start: 'lt_ban...',
      userId: 'user-banned',
      expiresAt: null,
      createdAt: new Date(),
    }

    const mockUserRecord = {
      id: 'user-banned',
      name: 'Mallory',
      email: 'mallory@example.com',
      role: 'editor',
      banned: true,
      banExpires: null,
    }

    const adapterFindOne = vi.fn().mockResolvedValue(mockKeyRecord)
    const internalFindUserById = vi.fn().mockResolvedValue(mockUserRecord)

    const mockAuth = {
      $context: Promise.resolve({
        adapter: { findOne: adapterFindOne },
        internalAdapter: { findUserById: internalFindUserById },
      }),
    } as unknown as Auth

    const res = await verifyApiKey(mockAuth, rawKey)
    expect(res.valid).toBe(false)
    expect(res.error).toBe('User account is disabled')
  })

  it('listApiKeys queries adapter and maps records', async () => {
    const mockRecords: Array<Record<string, unknown>> = [
      {
        id: 'k1',
        name: 'Key 1',
        start: 'lt_1...',
        userId: 'u1',
        createdAt: new Date(),
      },
    ]

    const adapterFindMany = vi.fn().mockResolvedValue(mockRecords)
    const mockAuth = {
      $context: Promise.resolve({
        adapter: { findMany: adapterFindMany },
      }),
    } as unknown as Auth

    const keys = await listApiKeys(mockAuth, 'u1')
    expect(keys).toHaveLength(1)
    expect(keys[0]!.id).toBe('k1')
    expect(adapterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'apikey',
        where: [{ field: 'userId', value: 'u1' }],
      }),
    )
  })

  it('revokeApiKey allows owner or admin, forbids other users', async () => {
    const mockRecord = {
      id: 'k-123',
      userId: 'owner-id',
    }

    const adapterFindOne = vi.fn().mockResolvedValue(mockRecord)
    const adapterDelete = vi.fn().mockResolvedValue({})

    const mockAuth = {
      $context: Promise.resolve({
        adapter: {
          findOne: adapterFindOne,
          delete: adapterDelete,
        },
      }),
    } as unknown as Auth

    const ownerUser = { id: 'owner-id', role: 'editor' } as AuthUser
    const otherUser = { id: 'other-id', role: 'editor' } as AuthUser
    const adminUser = { id: 'admin-id', role: 'admin' } as AuthUser

    // Owner can revoke
    const res1 = await revokeApiKey(mockAuth, 'k-123', ownerUser, 'admin')
    expect(res1).toBe(true)

    // Admin can revoke
    const res2 = await revokeApiKey(mockAuth, 'k-123', adminUser, 'admin')
    expect(res2).toBe(true)

    // Another non-admin user cannot revoke
    await expect(revokeApiKey(mockAuth, 'k-123', otherUser, 'admin')).rejects.toThrow(/Forbidden/)
  })

  describe('calculateExpiresAt (#380)', () => {
    it('returns null when expiresIn is undefined or null', () => {
      expect(calculateExpiresAt(undefined)).toBeNull()
      expect(calculateExpiresAt(null)).toBeNull()
    })

    it('rejects non-positive, non-integer, or non-number values', () => {
      expect(() => calculateExpiresAt(0)).toThrow('expiresIn must be a positive integer')
      expect(() => calculateExpiresAt(-10)).toThrow('expiresIn must be a positive integer')
      expect(() => calculateExpiresAt(1.5)).toThrow('expiresIn must be a positive integer')
      expect(() => calculateExpiresAt('3600' as unknown as number)).toThrow(
        'expiresIn must be a positive integer',
      )
    })

    it('rejects expiresIn past 2038-01-19 or safe max', () => {
      expect(() => calculateExpiresAt(1e13)).toThrow(
        'expiresIn must not exceed 2038-01-19T03:14:07Z',
      )
      const secondsPastMax = Math.floor((MAX_TIMESTAMP_MS - Date.now()) / 1000) + 100
      expect(() => calculateExpiresAt(secondsPastMax)).toThrow(
        'expiresIn must not exceed 2038-01-19T03:14:07Z',
      )
    })

    it('returns valid Date for positive integer within range', () => {
      const now = Date.now()
      const expiresAt = calculateExpiresAt(3600)
      expect(expiresAt).toBeInstanceOf(Date)
      expect(expiresAt!.getTime()).toBeGreaterThanOrEqual(now + 3599 * 1000)
      expect(expiresAt!.getTime()).toBeLessThanOrEqual(now + 3601 * 1000)
    })
  })

  describe('createApiKey validation (#380)', () => {
    it('rejects empty or excessively long names', async () => {
      const mockAuth = {
        $context: Promise.resolve({
          adapter: { create: vi.fn() },
        }),
      } as unknown as Auth

      await expect(
        createApiKey(mockAuth, {
          userId: 'user-1',
          name: '',
        }),
      ).rejects.toThrow('API key name must be between 1 and 255 characters')

      await expect(
        createApiKey(mockAuth, {
          userId: 'user-1',
          name: '   ',
        }),
      ).rejects.toThrow('API key name must be between 1 and 255 characters')

      await expect(
        createApiKey(mockAuth, {
          userId: 'user-1',
          name: 'a'.repeat(256),
        }),
      ).rejects.toThrow('API key name must be between 1 and 255 characters')
    })

    it('rejects missing userId or non-existent user when internalAdapter exists', async () => {
      const mockAuth = {
        $context: Promise.resolve({
          adapter: { create: vi.fn() },
          internalAdapter: {
            findUserById: vi.fn().mockResolvedValue(null),
          },
        }),
      } as unknown as Auth

      await expect(
        createApiKey(mockAuth, {
          userId: '',
          name: 'My Key',
        }),
      ).rejects.toThrow('userId is required')

      await expect(
        createApiKey(mockAuth, {
          userId: 'non-existent-user',
          name: 'My Key',
        }),
      ).rejects.toThrow('User not found')
    })
  })

  it('verifyApiKey handles lastUsedAt update failure without unhandled rejection (#380)', async () => {
    const rawKey = 'lt_validkey123456'
    const mockKeyRecord: Record<string, unknown> = {
      id: 'key-1',
      name: 'Prod Script',
      start: 'lt_valid...',
      userId: 'user-1',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    }

    const mockUserRecord = {
      id: 'user-1',
      name: 'Bob',
      email: 'bob@example.com',
      role: 'editor',
      banned: false,
    }

    const adapterFindOne = vi.fn().mockResolvedValue(mockKeyRecord)
    const adapterUpdate = vi.fn().mockRejectedValue(new Error('DB connection lost'))
    const internalFindUserById = vi.fn().mockResolvedValue(mockUserRecord)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mockAuth = {
      $context: Promise.resolve({
        adapter: {
          findOne: adapterFindOne,
          update: adapterUpdate,
        },
        internalAdapter: {
          findUserById: internalFindUserById,
        },
      }),
    } as unknown as Auth

    const res = await verifyApiKey(mockAuth, rawKey)
    expect(res.valid).toBe(true)

    // Wait a tick for microtask catch handler
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(warnSpy).toHaveBeenCalledWith(
      '[auth] Failed to update API key lastUsedAt:',
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })
})
