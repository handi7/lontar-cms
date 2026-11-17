import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  ApiClientError,
  createDoc,
  fetchDoc,
  fetchDocVersions,
  fetchDocVersionByID,
  formatApiErrorMessage,
  publishDoc,
  restoreDocVersion,
  fetchPermissions,
  fetchDocumentPermissions,
  fetchGlobalPermissions,
  fetchUsers,
  fetchUserById,
  createUser,
  updateUser,
  disableUser,
  enableUser,
  revokeUserSessions,
  adminSetUserPassword,
  deleteUser,
  updateMe,
  changeMyPassword,
  requestPasswordReset,
  resetPassword,
  resendUserInvite,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  setOnUnauthorized,
  signOut,
  unpublishDoc,
  updateDoc,
} from './client'

describe('ApiClientError and API Client error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setOnUnauthorized(null)
  })

  it('throws ApiClientError with issues when API returns 400 validation error', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: vi.fn().mockResolvedValue({
        error: 'Validation failed',
        issues: [
          {
            code: 'custom',
            path: ['slug'],
            message: 'Value "dup" is already taken',
          },
        ],
      }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response)

    try {
      await createDoc('/api', 'posts', { title: 'Test', slug: 'dup' })
      expect.fail('should have thrown ApiClientError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError)
      const apiErr = err as ApiClientError
      expect(apiErr.status).toBe(400)
      expect(apiErr.message).toBe('Validation failed')
      expect(apiErr.issues).toEqual([
        {
          code: 'custom',
          path: ['slug'],
          message: 'Value "dup" is already taken',
        },
      ])
    }
  })

  it('throws ApiClientError on 500 error without issues', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({
        error: 'Internal Server Error',
      }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response)

    try {
      await updateDoc('/api', 'posts', 1, { title: 'Update' })
      expect.fail('should have thrown ApiClientError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError)
      const apiErr = err as ApiClientError
      expect(apiErr.status).toBe(500)
      expect(apiErr.message).toBe('Internal Server Error')
      expect(apiErr.issues).toBeUndefined()
    }
  })

  it('throws ApiClientError when signOut fails with non-ok response', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({
        error: 'Sign out failed',
      }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response)

    try {
      await signOut('/api')
      expect.fail('should have thrown ApiClientError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError)
      const apiErr = err as ApiClientError
      expect(apiErr.status).toBe(500)
      expect(apiErr.message).toBe('Sign out failed')
    }
  })

  it('invokes onUnauthorized handler when a request returns 401', async () => {
    const onUnauthorized = vi.fn()
    setOnUnauthorized(onUnauthorized)

    const mockResponse = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: vi.fn().mockResolvedValue({
        error: 'Session expired',
      }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response)

    try {
      await updateDoc('/api', 'posts', 1, { title: 'Update' })
      expect.fail('should have thrown ApiClientError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError)
      expect((err as ApiClientError).status).toBe(401)
      expect(onUnauthorized).toHaveBeenCalledTimes(1)
    }
  })

  describe('formatApiErrorMessage', () => {
    it('formats ApiClientError with issue details', () => {
      const err = new ApiClientError('Validation failed', 400, [
        { message: 'Title is required' },
        { message: 'Slug is already taken' },
      ])
      expect(formatApiErrorMessage(err)).toBe(
        'Validation failed: Title is required, Slug is already taken',
      )
    })

    it('returns error message when ApiClientError has no issues', () => {
      const err = new ApiClientError('Forbidden', 403)
      expect(formatApiErrorMessage(err)).toBe('Forbidden')
    })

    it('returns standard Error message', () => {
      const err = new Error('Network failure')
      expect(formatApiErrorMessage(err)).toBe('Network failure')
    })

    it('returns string representation of unknown error', () => {
      expect(formatApiErrorMessage('Something went wrong')).toBe('Something went wrong')
    })
  })

  describe('draft and publish operations', () => {
    it('appends ?draft=true when requested in fetchDoc, createDoc, and updateDoc', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 1, title: 'Draft Post', _status: 'draft' }),
      } as unknown as Response)

      await fetchDoc('/api', 'posts', 1, { draft: true })
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/posts/1?draft=true', {
        credentials: 'include',
      })

      await createDoc('/api', 'posts', { title: 'Draft' }, { draft: true })
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/posts?draft=true',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'Draft' }) }),
      )

      await updateDoc('/api', 'posts', 1, { title: 'Updated Draft' }, { draft: true })
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/posts/1?draft=true',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Updated Draft' }),
        }),
      )
    })

    it('calls /publish and /unpublish endpoints', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 1, _status: 'published' }),
      } as unknown as Response)

      await publishDoc('/api', 'posts', 1)
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/posts/1/publish',
        expect.objectContaining({ method: 'POST' }),
      )

      await unpublishDoc('/api', 'posts', 1)
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/posts/1/unpublish',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('version history operations', () => {
    it('fetches version list with pagination params', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ docs: [], totalDocs: 0, page: 1, limit: 10, totalPages: 1 }),
      } as unknown as Response)

      await fetchDocVersions('/api', 'posts', 1, { page: 2, limit: 5 })
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/posts/1/versions?page=2&limit=5', {
        credentials: 'include',
      })
    })

    it('fetches single version by ID', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 10, versionNumber: 2 }),
      } as unknown as Response)

      await fetchDocVersionByID('/api', 'posts', 1, 10)
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/posts/1/versions/10', {
        credentials: 'include',
      })
    })

    it('restores a version via POST to /versions/:versionId/restore', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 1, title: 'Restored' }),
      } as unknown as Response)

      await restoreDocVersion('/api', 'posts', 1, 10)
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/posts/1/versions/10/restore',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('sends draft=true and autosave=true query params on autosave update', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 1, title: 'Autosaved' }),
      } as unknown as Response)

      await updateDoc('/api', 'posts', 1, { title: 'Autosaved' }, { autosave: true })
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/posts/1?draft=true&autosave=true',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  describe('permissions operations (#341)', () => {
    it('fetches base permissions from /_lontar/permissions', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ collections: {}, globals: {} }),
      } as unknown as Response)

      const result = await fetchPermissions('/api')
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/_lontar/permissions', {
        credentials: 'include',
      })
      expect(result).toEqual({ collections: {}, globals: {} })
    })

    it('fetches document-specific permissions', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ create: true, read: true, update: false, delete: false }),
      } as unknown as Response)

      const result = await fetchDocumentPermissions('/api', 'posts', 1, { draft: true })
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/_lontar/permissions/posts/1?draft=true', {
        credentials: 'include',
      })
      expect(result.update).toBe(false)
    })

    it('fetches global permissions', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ read: true, update: true, fields: {} }),
      } as unknown as Response)

      const result = await fetchGlobalPermissions('/api', 'site-settings')
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/_lontar/permissions/globals/site-settings', {
        credentials: 'include',
      })
      expect(result.read).toBe(true)
    })
  })

  describe('user management and account operations (#343)', () => {
    it('fetches users list with query parameters', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          docs: [{ id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'admin' }],
          totalDocs: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      } as unknown as Response)

      const result = await fetchUsers('/api', { page: 2, limit: 5, search: 'alice', role: 'admin' })
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/_lontar/users?page=2&limit=5&search=alice&role=admin',
        { credentials: 'include' },
      )
      expect(result.docs).toHaveLength(1)
    })

    it('creates a user', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          user: { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'editor' },
        }),
      } as unknown as Response)

      const user = await createUser('/api', {
        name: 'Bob',
        email: 'bob@example.com',
        password: 'password123',
        role: 'editor',
      })
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/_lontar/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Bob',
            email: 'bob@example.com',
            password: 'password123',
            role: 'editor',
          }),
        }),
      )
      expect(user.id).toBe('u2')
    })

    it('updates, disables, enables, and deletes a user', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          user: { id: 'u1', name: 'Alice Updated', role: 'editor' },
          message: 'Success',
        }),
      } as unknown as Response)

      const fetched = await fetchUserById('/api', 'u1')
      expect(fetchSpy).toHaveBeenCalledWith('/api/_lontar/users/u1', { credentials: 'include' })
      expect(fetched.id).toBe('u1')

      await updateUser('/api', 'u1', { name: 'Alice Updated', role: 'editor' })
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/users/u1',
        expect.objectContaining({ method: 'PATCH' }),
      )

      await revokeUserSessions('/api', 'u1')
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/users/u1/revoke-sessions',
        expect.objectContaining({ method: 'POST' }),
      )

      await adminSetUserPassword('/api', 'u1', 'newpassword123')
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/users/u1/password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'newpassword123' }),
        }),
      )

      await disableUser('/api', 'u1', 'Suspicious activity')
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/users/u1/disable',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'Suspicious activity' }),
        }),
      )

      await enableUser('/api', 'u1')
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/users/u1/enable',
        expect.objectContaining({ method: 'POST' }),
      )

      await deleteUser('/api', 'u1')
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/users/u1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })

    it('updates current user name and changes password', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          user: { id: 'u1', name: 'Handi Updated' },
          message: 'Password changed successfully',
        }),
      } as unknown as Response)

      const me = await updateMe('/api', { name: 'Handi Updated' })
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/me',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Handi Updated' }),
        }),
      )
      expect(me.name).toBe('Handi Updated')

      await changeMyPassword('/api', {
        currentPassword: 'old-password',
        newPassword: 'new-password123',
      })
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/me/password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            currentPassword: 'old-password',
            newPassword: 'new-password123',
          }),
        }),
      )
    })

    it('handles requestPasswordReset, resetPassword, and resendUserInvite', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: true, message: 'Success' }),
      } as unknown as Response)

      await requestPasswordReset('/api', 'test@example.com')
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/request-password-reset',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com' }),
        }),
      )

      await resetPassword('/api', { token: 'tok123', newPassword: 'newpass123' })
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/reset-password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'tok123', newPassword: 'newpass123' }),
        }),
      )

      await resendUserInvite('/api', 'u123')
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/users/u123/resend-invite',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })

    it('handles listApiKeys, createApiKey, and revokeApiKey', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          docs: [{ id: 'k1', name: 'Test', start: 'lt_123...', createdAt: '2026-01-01' }],
          apiKey: { id: 'k1', name: 'Test', key: 'lt_rawkey', start: 'lt_123...' },
          success: true,
        }),
      } as unknown as Response)

      const keys = await listApiKeys('/api')
      expect(keys).toHaveLength(1)
      expect(fetchSpy).toHaveBeenCalledWith('/api/_lontar/api-keys', {
        credentials: 'include',
      })

      const created = await createApiKey('/api', { name: 'New Key', expiresIn: 3600 })
      expect(created.key).toBe('lt_rawkey')
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/_lontar/api-keys',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Key', expiresIn: 3600 }),
        }),
      )

      const revoked = await revokeApiKey('/api', 'k1')
      expect(revoked.success).toBe(true)
      expect(fetchSpy).toHaveBeenCalledWith('/api/_lontar/api-keys/k1', {
        method: 'DELETE',
        credentials: 'include',
      })
    })
  })
})
