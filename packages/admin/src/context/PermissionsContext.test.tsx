import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  PermissionsProvider,
  usePermissions,
  useDocumentPermissions,
  useGlobalPermissions,
} from './PermissionsContext'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'
import type { PermissionsResponse } from '@lontar/core/client'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    fetchPermissions: vi.fn(),
    fetchDocumentPermissions: vi.fn(),
    fetchGlobalPermissions: vi.fn(),
  }
})

describe('PermissionsContext', () => {
  let queryClient: QueryClient

  const mockPermissions: PermissionsResponse = {
    collections: {
      articles: {
        read: true,
        create: true,
        update: true,
        delete: false,
        readVersions: true,
        fields: {
          title: { read: true, create: true, update: true },
          secret: { read: false, create: false, update: false },
        },
      },
      hidden: {
        read: false,
        create: false,
        update: false,
        delete: false,
        readVersions: false,
        fields: {},
      },
    },
    globals: {
      settings: {
        read: true,
        update: false,
        readVersions: true,
        fields: {
          siteName: { read: true, create: true, update: false },
        },
      },
      secretGlobal: {
        read: false,
        update: false,
        readVersions: false,
        fields: {},
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  function createWrapper(apiBase = '/api', user: { id: string } | null = { id: 'u1' }) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <PermissionsProvider apiBase={apiBase} user={user}>
            {children}
          </PermissionsProvider>
        </QueryClientProvider>
      )
    }
  }

  it('fetches permissions and exposes permission check helpers', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue(mockPermissions)

    const { result } = renderHook(() => usePermissions(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isPermissionsLoading).toBe(false)
    })

    expect(result.current.permissions).toEqual(mockPermissions)
    expect(result.current.canReadCollection('articles')).toBe(true)
    expect(result.current.canCreateInCollection('articles')).toBe(true)
    expect(result.current.canDeleteInCollection('articles')).toBe(false)
    expect(result.current.canReadCollection('hidden')).toBe(false)
    expect(result.current.canCreateInCollection('hidden')).toBe(false)

    expect(result.current.canReadGlobal('settings')).toBe(true)
    expect(result.current.canReadGlobal('secretGlobal')).toBe(false)
  })

  it('defaults helpers to true if collection/global not in permissions map', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {},
      globals: {},
    })

    const { result } = renderHook(() => usePermissions(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isPermissionsLoading).toBe(false)
    })

    expect(result.current.canReadCollection('unknown')).toBe(true)
    expect(result.current.canCreateInCollection('unknown')).toBe(true)
    expect(result.current.canDeleteInCollection('unknown')).toBe(true)
    expect(result.current.canReadGlobal('unknown')).toBe(true)
  })

  it('useDocumentPermissions queries document permissions', async () => {
    const docPerm = {
      read: true,
      create: false,
      update: false,
      delete: false,
      readVersions: false,
      fields: { title: { read: true, create: false, update: false } },
    }
    vi.mocked(client.fetchDocumentPermissions).mockResolvedValue(docPerm)

    const { result } = renderHook(() => useDocumentPermissions('/api', 'articles', '123', true), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual(docPerm)
    })
    expect(client.fetchDocumentPermissions).toHaveBeenCalledWith('/api', 'articles', '123', {
      draft: true,
    })
    expect(
      queryClient.getQueryData([
        '_lontar_document_permissions',
        '/api',
        'articles',
        '123',
        'draft',
        'u1',
      ]),
    ).toEqual(docPerm)
  })

  it('useGlobalPermissions queries global permissions', async () => {
    const globPerm = {
      read: true,
      update: false,
      readVersions: false,
      fields: { siteName: { read: true, create: false, update: false } },
    }
    vi.mocked(client.fetchGlobalPermissions).mockResolvedValue(globPerm)

    const { result } = renderHook(() => useGlobalPermissions('/api', 'settings'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual(globPerm)
    })
    expect(client.fetchGlobalPermissions).toHaveBeenCalledWith('/api', 'settings')
    expect(
      queryClient.getQueryData(['_lontar_global_permissions', '/api', 'settings', 'u1']),
    ).toEqual(globPerm)
  })
})
