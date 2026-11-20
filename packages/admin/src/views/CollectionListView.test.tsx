import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  CLIENT_CONFIG_VERSION,
  type ClientCollection,
  type ClientConfig,
  type CollectionPermission,
} from '@lontar/core/client'
import { PortalContainerProvider } from '../context/PortalContainer'
import { CollectionListView } from './CollectionListView'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'
import { PermissionsProvider } from '../context/PermissionsContext'
import { AdminContext } from '../context/AdminContext'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    fetchCollectionDocs: vi.fn(),
    deleteDoc: vi.fn(),
    fetchPermissions: vi.fn(),
  }
})

let capturedNavigateSearch: ((prev: Record<string, unknown>) => Record<string, unknown>) | undefined

const mockNavigate = vi.fn(
  (opts: { search?: (prev: Record<string, unknown>) => Record<string, unknown> }) => {
    if (typeof opts?.search === 'function') {
      capturedNavigateSearch = opts.search
    }
  },
)

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ collection: 'articles' }),
  useNavigate: () => mockNavigate,
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode
    to: string
    search?: (prev: Record<string, unknown>) => Record<string, unknown>
  }) => {
    const s = typeof search === 'function' ? search({}) : {}
    const params = new URLSearchParams()
    if (s && typeof s === 'object') {
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          params.set(k, String(v))
        }
      }
    }
    const query = params.toString() ? `?${params.toString()}` : ''
    return <a href={`${to}${query}`}>{children}</a>
  },
}))

const mockArticlesCollection: ClientCollection = {
  slug: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'secretNotes'],
  },
  fields: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'secretNotes', label: 'Secret Notes', type: 'text', required: false },
  ],
}

function mockCollectionPerm(overrides: Partial<CollectionPermission> = {}): CollectionPermission {
  return {
    read: true,
    create: true,
    update: true,
    delete: true,
    readVersions: true,
    fields: {},
    ...overrides,
  }
}

describe('CollectionListView permissions (#341)', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    vi.mocked(client.fetchCollectionDocs).mockResolvedValue({
      docs: [
        { id: 1, title: 'Article 1', secretNotes: 'Classified' },
        { id: 2, title: 'Article 2', secretNotes: 'Top Secret' },
      ],
      totalDocs: 2,
      limit: 10,
      page: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    })
  })

  afterEach(cleanup)

  function renderWithProviders(configOverride?: Partial<ClientConfig>) {
    const adminConfig: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
      collections: [mockArticlesCollection],
      globals: [],
      ...configOverride,
    }

    return render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <QueryClientProvider client={queryClient}>
            <AdminContext.Provider
              value={{
                config: adminConfig,
                apiBase: '/api',
                basePath: '/admin',
              }}
            >
              <PermissionsProvider apiBase="/api" user={{ id: 'u1' }}>
                <CollectionListView />
              </PermissionsProvider>
            </AdminContext.Provider>
          </QueryClientProvider>
        </PortalContainerProvider>
      </div>,
    )
  }

  it('hides Create Article button when user does not have create permission', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm({ create: false }),
      },
      globals: {},
    })

    renderWithProviders()

    expect(await screen.findByText('Articles')).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /Create Article/i })).toBeNull()
    })
  })

  it('shows Create Article button when user has create permission', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm({ create: true }),
      },
      globals: {},
    })

    renderWithProviders()

    expect(await screen.findByRole('link', { name: /Create Article/i })).toBeTruthy()
  })

  it('hides delete action button when user does not have delete permission', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm({ delete: false }),
      },
      globals: {},
    })

    renderWithProviders()

    expect(await screen.findByText('Article 1')).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete document' })).toBeNull()
    })
  })

  it('excludes unreadable column when field has read: false', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm({
          fields: {
            title: { read: true, create: true, update: true },
            secretNotes: { read: false, create: false, update: false },
          },
        }),
      },
      globals: {},
    })

    renderWithProviders()

    expect(await screen.findByText('Article 1')).toBeTruthy()
    expect(screen.getByText('Title')).toBeTruthy()
    await waitFor(() => {
      // Secret Notes column header should NOT exist
      expect(screen.queryByText('Secret Notes')).toBeNull()
    })
    // Classified data should not be displayed
    expect(screen.queryByText('Classified')).toBeNull()
  })

  it('renders NotFoundView when user cannot read collection', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm({
          read: false,
          create: false,
          update: false,
          delete: false,
          readVersions: false,
        }),
      },
      globals: {},
    })

    renderWithProviders()

    expect(await screen.findByText('Page Not Found')).toBeTruthy()
  })

  it('renders LocaleSwitcher and queries with active locale and fallbackLocale (#429)', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm(),
      },
      globals: {},
    })

    renderWithProviders({
      localization: {
        locales: [
          { code: 'en', label: 'English' },
          { code: 'id', label: 'Indonesian' },
        ],
        defaultLocale: 'en',
        fallback: true,
      },
    })

    expect(await screen.findByText('Articles')).toBeTruthy()

    // Locale switcher is rendered
    expect(screen.getByTestId('locale-switcher')).toBeTruthy()

    // fetchCollectionDocs was called with locale='en' and fallbackLocale='en'
    expect(client.fetchCollectionDocs).toHaveBeenCalledWith(
      '/api',
      'articles',
      expect.objectContaining({
        locale: 'en',
        fallbackLocale: 'en',
      }),
    )

    // Create link preserves locale
    const createLink = screen.getByRole('link', { name: /Create Article/i })
    expect(createLink.getAttribute('href')).toContain('locale=en')

    // Wait for table to load
    expect(await screen.findByText('Article 1')).toBeTruthy()

    // Edit link preserves locale
    const editLinks = screen.getAllByRole('link', { name: 'Edit' })
    expect(editLinks[0]?.getAttribute('href')).toContain('locale=en')

    // Switch locale using switcher
    const switcher = screen.getByTestId('locale-switcher')
    switcher.click()

    const idOption = await screen.findByTestId('locale-option-id')
    idOption.click()

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(capturedNavigateSearch?.({ page: 2 })).toEqual({
      page: 2,
      locale: 'id',
    })
  })
})
