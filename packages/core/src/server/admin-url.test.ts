import { describe, expect, it, afterEach } from 'vitest'
import { resolveAdminBaseUrl } from './admin-url'
import type { Auth } from '../auth/types'

describe('resolveAdminBaseUrl', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('resolves admin URL from options.baseURL', async () => {
    const url = await resolveAdminBaseUrl(null, { baseURL: 'https://example.com' })
    expect(url).toBe('https://example.com/admin')
  })

  it('respects custom adminPath with trailing slash handling', async () => {
    const url = await resolveAdminBaseUrl(null, {
      baseURL: 'https://example.com/subpath',
      adminPath: '/custom-admin/',
    })
    expect(url).toBe('https://example.com/custom-admin')
  })

  it('resolves origin from auth.$context.baseURL when options.baseURL is not set', async () => {
    const fakeAuth = {
      $context: Promise.resolve({
        baseURL: 'https://auth-context.example.org/api/auth',
      }),
    } as unknown as Auth

    const url = await resolveAdminBaseUrl(fakeAuth)
    expect(url).toBe('https://auth-context.example.org/admin')
  })

  it('resolves origin from BETTER_AUTH_URL env when options.baseURL and auth context are unset', async () => {
    process.env.BETTER_AUTH_URL = 'https://env-origin.example.net/api/auth'
    const url = await resolveAdminBaseUrl(null)
    expect(url).toBe('https://env-origin.example.net/admin')
  })

  it('prioritizes options.baseURL over BETTER_AUTH_URL and auth context', async () => {
    process.env.BETTER_AUTH_URL = 'https://env-origin.example.net/api/auth'
    const fakeAuth = {
      $context: Promise.resolve({
        baseURL: 'https://auth-context.example.org/api/auth',
      }),
    } as unknown as Auth

    const url = await resolveAdminBaseUrl(fakeAuth, {
      baseURL: 'https://options-origin.example.com',
    })
    expect(url).toBe('https://options-origin.example.com/admin')
  })

  it('returns null when neither options.baseURL, auth context, nor BETTER_AUTH_URL is configured', async () => {
    delete process.env.BETTER_AUTH_URL
    const fakeAuth = {
      $context: Promise.resolve({ baseURL: '' }),
    } as unknown as Auth

    const url = await resolveAdminBaseUrl(fakeAuth)
    expect(url).toBeNull()
  })

  it('returns null when auth is null and BETTER_AUTH_URL is not set', async () => {
    delete process.env.BETTER_AUTH_URL
    const url = await resolveAdminBaseUrl(null)
    expect(url).toBeNull()
  })
})
