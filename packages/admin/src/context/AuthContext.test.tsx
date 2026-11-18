import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './AuthContext'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    fetchSession: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    setOnUnauthorized: vi.fn(),
  }
})

describe('AuthContext and clearUserData (#374)', () => {
  let queryClient: QueryClient
  let capturedUnauthorizedHandler: (() => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    capturedUnauthorizedHandler = null
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    vi.mocked(client.setOnUnauthorized).mockImplementation((handler) => {
      capturedUnauthorizedHandler = handler
    })

    vi.mocked(client.fetchSession).mockResolvedValue({
      user: { id: 'u1', email: 'u1@example.com', name: 'User 1', role: 'admin' },
      session: { id: 's1', userId: 'u1', expiresAt: '2026-12-31T00:00:00.000Z' },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createWrapper(apiBase = '/api') {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <AuthProvider apiBase={apiBase}>{children}</AuthProvider>
        </QueryClientProvider>
      )
    }
  }

  function seedQueries() {
    queryClient.setQueryData(['_lontar_config'], { version: 1 })
    queryClient.setQueryData(['_lontar_permissions', '/api', 'u1'], { collections: {} })
    queryClient.setQueryData(
      ['_lontar_document_permissions', '/api', 'articles', '1', 'draft', 'u1'],
      { read: true },
    )
    queryClient.setQueryData(['_lontar_global_permissions', '/api', 'settings', 'u1'], {
      read: true,
    })
    queryClient.setQueryData(['_lontar_api_keys', '/api', 'u1'], [{ id: 'k1' }])
    queryClient.setQueryData(['_lontar_users', '/api', 1, '', ''], [{ id: 'u1' }])
    queryClient.setQueryData(['_lontar_user', '/api', 'u1'], { id: 'u1' })
    queryClient.setQueryData(['document', 'articles', '1', 'draft'], { id: 1 })
  }

  it('removes all user queries on signOut, keeping only _lontar_config and resetting _lontar_session', async () => {
    vi.mocked(client.signOut).mockImplementation(() => {
      vi.mocked(client.fetchSession).mockResolvedValue(null)
      return Promise.resolve()
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.user?.id).toBe('u1')
    })

    seedQueries()

    await act(async () => {
      await result.current.signOut()
    })

    // Public config is retained
    expect(queryClient.getQueryData(['_lontar_config'])).toEqual({ version: 1 })

    // Session is reset to null
    expect(queryClient.getQueryData(['_lontar_session', '/api'])).toBeNull()

    // All user-scoped and doc queries are removed from cache
    expect(queryClient.getQueryData(['_lontar_permissions', '/api', 'u1'])).toBeUndefined()
    expect(
      queryClient.getQueryData([
        '_lontar_document_permissions',
        '/api',
        'articles',
        '1',
        'draft',
        'u1',
      ]),
    ).toBeUndefined()
    expect(
      queryClient.getQueryData(['_lontar_global_permissions', '/api', 'settings', 'u1']),
    ).toBeUndefined()
    expect(queryClient.getQueryData(['_lontar_api_keys', '/api', 'u1'])).toBeUndefined()
    expect(queryClient.getQueryData(['_lontar_users', '/api', 1, '', ''])).toBeUndefined()
    expect(queryClient.getQueryData(['_lontar_user', '/api', 'u1'])).toBeUndefined()
    expect(queryClient.getQueryData(['document', 'articles', '1', 'draft'])).toBeUndefined()
  })

  it('removes all user queries when onUnauthorized is triggered', async () => {
    renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(capturedUnauthorizedHandler).not.toBeNull()
    })

    seedQueries()

    act(() => {
      capturedUnauthorizedHandler!()
    })

    // Config is preserved
    expect(queryClient.getQueryData(['_lontar_config'])).toEqual({ version: 1 })

    // Session is reset
    expect(queryClient.getQueryData(['_lontar_session', '/api'])).toBeNull()

    // Permissions and user data removed
    expect(queryClient.getQueryData(['_lontar_permissions', '/api', 'u1'])).toBeUndefined()
    expect(
      queryClient.getQueryData([
        '_lontar_document_permissions',
        '/api',
        'articles',
        '1',
        'draft',
        'u1',
      ]),
    ).toBeUndefined()
    expect(queryClient.getQueryData(['_lontar_api_keys', '/api', 'u1'])).toBeUndefined()
    expect(queryClient.getQueryData(['document', 'articles', '1', 'draft'])).toBeUndefined()
  })
})
