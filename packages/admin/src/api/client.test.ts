import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  ApiClientError,
  createDoc,
  formatApiErrorMessage,
  setOnUnauthorized,
  signOut,
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
})
