import * as coreModule from '@lontar/core'
import type { AuthUser, Config, LontarApp } from '@lontar/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as configModule from '../config'
import { createUser } from './create-user'

describe('createUser command', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('validates required fields before loading config or touching db', async () => {
    await expect(
      createUser({ email: 'invalid', password: 'password123', name: 'Admin' }),
    ).rejects.toThrow('A valid --email argument is required')
    await expect(
      createUser({ email: 'admin@example.com', password: 'short', name: 'Admin' }),
    ).rejects.toThrow('A --password argument with at least 8 characters is required')
    await expect(
      createUser({ email: 'admin@example.com', password: 'password123', name: '' }),
    ).rejects.toThrow('A --name argument is required')
  })

  it('closes db connection on success', async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined)
    const mockDb = { close: closeSpy }
    const mockConfig = { secret: 'test-secret', db: mockDb, collections: [] }
    const mockAuth = {}
    const mockUser = { id: 1, email: 'admin@example.com', name: 'Admin' }

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(mockConfig as unknown as Config)
    vi.spyOn(coreModule, 'createLontar').mockReturnValue({
      auth: mockAuth,
    } as unknown as LontarApp)
    vi.spyOn(coreModule, 'createUserWithCredential').mockResolvedValue(
      mockUser as unknown as AuthUser,
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createUser({
      email: 'admin@example.com',
      password: 'password123',
      name: 'Admin',
    })

    expect(coreModule.createUserWithCredential).toHaveBeenCalledWith(mockAuth, {
      email: 'admin@example.com',
      password: 'password123',
      name: 'Admin',
    })
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Created user admin@example.com'))
  })

  it('closes db connection on failure', async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined)
    const mockDb = { close: closeSpy }
    const mockConfig = { secret: 'test-secret', db: mockDb, collections: [] }
    const mockAuth = {}

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(mockConfig as unknown as Config)
    vi.spyOn(coreModule, 'createLontar').mockReturnValue({
      auth: mockAuth,
    } as unknown as LontarApp)
    vi.spyOn(coreModule, 'createUserWithCredential').mockRejectedValue(
      new Error('User already exists'),
    )

    await expect(
      createUser({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin',
      }),
    ).rejects.toThrow('User already exists')

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('works safely when db has no close method', async () => {
    const mockDb = {}
    const mockConfig = { secret: 'test-secret', db: mockDb, collections: [] }
    const mockAuth = {}
    const mockUser = { id: 1, email: 'admin@example.com', name: 'Admin' }

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(mockConfig as unknown as Config)
    vi.spyOn(coreModule, 'createLontar').mockReturnValue({
      auth: mockAuth,
    } as unknown as LontarApp)
    vi.spyOn(coreModule, 'createUserWithCredential').mockResolvedValue(
      mockUser as unknown as AuthUser,
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      createUser({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin',
      }),
    ).resolves.toBeUndefined()
  })
})
