import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
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
    publishDoc: vi.fn(),
    unpublishDoc: vi.fn(),
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

let mockRouteSearch: Record<string, unknown> = {}
const routeSearchListeners = new Set<() => void>()

function setRouteSearch(next: Record<string, unknown>) {
  mockRouteSearch = next
  act(() => routeSearchListeners.forEach((listener) => listener()))
}

function subscribeRouteSearch(listener: () => void) {
  routeSearchListeners.add(listener)
  return () => routeSearchListeners.delete(listener)
}

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ collection: 'articles' }),
  useSearch: () => useSyncExternalStore(subscribeRouteSearch, () => mockRouteSearch),
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
    mockRouteSearch = {}
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

  function renderWithProviders(configOverride?: Partial<ClientConfig>, userId = 'u1') {
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
              <PermissionsProvider apiBase="/api" user={{ id: userId }}>
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

  it('reads page, search, sort and filters from the URL (#214)', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: { articles: mockCollectionPerm() },
      globals: {},
    })
    mockRouteSearch = {
      page: 3,
      q: 'hello',
      sort: '-title',
      filters: [
        { field: 'title', operator: 'equals', value: 'x' },
        { field: 'bogus', operator: 'equals', value: 'dropped' },
      ],
    }

    renderWithProviders()

    expect(await screen.findByText('Article 1')).toBeTruthy()
    expect(client.fetchCollectionDocs).toHaveBeenLastCalledWith(
      '/api',
      'articles',
      expect.objectContaining({
        page: 3,
        sort: '-title',
        where: { title: { contains: 'hello', equals: 'x' } },
      }),
    )
    expect(screen.getByLabelText('Search Articles')).toHaveProperty('value', 'hello')
    expect(screen.queryByText(/bogus/)).toBeNull()
  })

  it('writes the search to the URL, replacing the history entry (#214)', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: { articles: mockCollectionPerm() },
      globals: {},
    })
    renderWithProviders()
    expect(await screen.findByText('Article 1')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search Articles'), { target: { value: 'foo' } })

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1))
    expect(mockNavigate.mock.calls[0]?.[0]).toMatchObject({ replace: true })
    expect(capturedNavigateSearch?.({ page: 4, locale: 'id' })).toEqual({
      page: undefined,
      q: 'foo',
      locale: 'id',
    })
  })

  it('resets to page 1 when a filter is removed (#214)', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: { articles: mockCollectionPerm() },
      globals: {},
    })
    mockRouteSearch = {
      page: 2,
      filters: [{ field: 'title', operator: 'equals', value: 'x' }],
    }
    renderWithProviders()

    fireEvent.click(await screen.findByLabelText('Remove title filter'))

    expect(mockNavigate.mock.calls[0]?.[0]).not.toMatchObject({ replace: true })
    expect(capturedNavigateSearch?.({ page: 2 })).toEqual({ page: undefined, filters: undefined })
  })

  describe('row selection and bulk actions (#460)', () => {
    const draftsArticles: ClientCollection = {
      ...mockArticlesCollection,
      versions: { drafts: true },
    }

    function allowAll(overrides: Partial<CollectionPermission> = {}) {
      vi.mocked(client.fetchPermissions).mockResolvedValue({
        collections: { articles: mockCollectionPerm(overrides) },
        globals: {},
      })
    }

    const bar = () => within(screen.getByRole('toolbar', { name: 'Bulk actions' }))

    async function selectBothRows() {
      fireEvent.click(await screen.findByLabelText('Select Article 1'))
      fireEvent.click(screen.getByLabelText('Select Article 2'))
    }

    it('selects rows, selects the whole page and clears the selection', async () => {
      allowAll()
      renderWithProviders()

      fireEvent.click(await screen.findByLabelText('Select Article 1'))
      expect(screen.getByTestId('bulk-count').textContent).toBe('1 selected')

      fireEvent.click(screen.getByLabelText('Select all on this page'))
      expect(screen.getByTestId('bulk-count').textContent).toBe('2 selected')

      fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
      expect(screen.queryByTestId('bulk-count')).toBeNull()
    })

    it('clears the selection when the page changes', async () => {
      allowAll()
      renderWithProviders()
      fireEvent.click(await screen.findByLabelText('Select Article 1'))
      expect(screen.getByTestId('bulk-count')).toBeTruthy()

      setRouteSearch({ page: 2 })

      await waitFor(() => expect(screen.queryByTestId('bulk-count')).toBeNull())
    })

    it('hides selection entirely when the user can neither delete nor publish', async () => {
      allowAll({ delete: false })
      renderWithProviders()

      expect(await screen.findByText('Article 1')).toBeTruthy()
      expect(screen.queryByLabelText('Select all on this page')).toBeNull()
    })

    it('hides Publish and Unpublish when the collection has no drafts', async () => {
      allowAll()
      renderWithProviders()
      fireEvent.click(await screen.findByLabelText('Select Article 1'))

      expect(bar().getByRole('button', { name: 'Delete' })).toBeTruthy()
      expect(bar().queryByRole('button', { name: 'Publish' })).toBeNull()
      expect(bar().queryByRole('button', { name: 'Unpublish' })).toBeNull()
    })

    it('hides Delete without delete access but keeps Publish and Unpublish', async () => {
      allowAll({ delete: false })
      renderWithProviders({ collections: [draftsArticles] })
      fireEvent.click(await screen.findByLabelText('Select Article 1'))

      expect(bar().getByRole('button', { name: 'Publish' })).toBeTruthy()
      expect(bar().getByRole('button', { name: 'Unpublish' })).toBeTruthy()
      expect(bar().queryByRole('button', { name: 'Delete' })).toBeNull()
    })

    it('hides Publish and Unpublish without update access', async () => {
      allowAll({ update: false })
      renderWithProviders({ collections: [draftsArticles] })
      fireEvent.click(await screen.findByLabelText('Select Article 1'))

      expect(bar().queryByRole('button', { name: 'Publish' })).toBeNull()
      expect(bar().getByRole('button', { name: 'Delete' })).toBeTruthy()
    })

    it('deletes the selected documents after confirming and refreshes once', async () => {
      allowAll()
      vi.mocked(client.deleteDoc).mockResolvedValue({ success: true })
      renderWithProviders()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      await selectBothRows()

      fireEvent.click(bar().getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog.textContent).toContain('Delete 2 documents')
      expect(client.deleteDoc).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2' }))

      await waitFor(() => expect(client.deleteDoc).toHaveBeenCalledTimes(2))
      expect(client.deleteDoc).toHaveBeenCalledWith('/api', 'articles', 1)
      expect(client.deleteDoc).toHaveBeenCalledWith('/api', 'articles', 2)
      expect((await screen.findByTestId('bulk-summary')).textContent).toContain(
        'Deleted 2 documents.',
      )
      expect(invalidate).toHaveBeenCalledTimes(1)
    })

    it('publishes the selected documents in the active locale', async () => {
      allowAll()
      vi.mocked(client.publishDoc).mockResolvedValue({})
      renderWithProviders({
        collections: [draftsArticles],
        localization: {
          locales: [
            { code: 'en', label: 'English' },
            { code: 'id', label: 'Indonesian' },
          ],
          defaultLocale: 'en',
          fallback: true,
        },
      })
      await selectBothRows()

      fireEvent.click(bar().getByRole('button', { name: 'Publish' }))

      await waitFor(() => expect(client.publishDoc).toHaveBeenCalledTimes(2))
      expect(client.publishDoc).toHaveBeenCalledWith('/api', 'articles', 1, { locale: 'en' })
    })

    it('reports a partial failure and keeps the failed document selected', async () => {
      allowAll()
      vi.mocked(client.deleteDoc).mockImplementation((_base, _slug, id) =>
        id === 2
          ? Promise.reject(new client.ApiClientError('Not allowed', 403))
          : Promise.resolve({ success: true }),
      )
      renderWithProviders()
      await selectBothRows()

      fireEvent.click(bar().getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('alertdialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2' }))

      const summary = await screen.findByTestId('bulk-summary')
      expect(summary.textContent).toContain('Deleted 1 document, 1 failed')
      expect(summary.textContent).toContain('Article 2')
      expect(summary.textContent).toContain('Not allowed')
      expect(screen.getByTestId('bulk-count').textContent).toBe('1 selected')
      expect(screen.getByLabelText('Select Article 2').getAttribute('data-state')).toBe('checked')
      expect(screen.getByLabelText('Select Article 1').getAttribute('data-state')).toBe('unchecked')
    })
  })

  describe('column picker (#461)', () => {
    const viewsCollection: ClientCollection = {
      ...mockArticlesCollection,
      fields: [
        ...mockArticlesCollection.fields,
        { name: 'views', label: 'Views', type: 'number', required: false },
      ],
    }
    const key = (user: string) => `lontar-admin-columns:${user}:articles`

    beforeEach(() => {
      window.localStorage.clear()
      vi.mocked(client.fetchPermissions).mockResolvedValue({
        collections: { articles: mockCollectionPerm() },
        globals: {},
      })
    })

    afterEach(() => {
      window.localStorage.clear()
      vi.restoreAllMocks()
    })

    const header = (name: string | RegExp) => screen.queryByRole('columnheader', { name })

    async function openPicker() {
      fireEvent.click(await screen.findByRole('button', { name: 'Columns' }))
      return screen.findByRole('checkbox', { name: /Title/ })
    }

    it('toggles a column on and off and remembers the choice', async () => {
      renderWithProviders({ collections: [viewsCollection] })
      await openPicker()
      expect(header(/Views/)).toBeNull()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Views' }))
      await waitFor(() => expect(header(/Views/)).toBeTruthy())
      expect(JSON.parse(window.localStorage.getItem(key('u1')) ?? 'null')).toEqual([
        'title',
        'secretNotes',
        'views',
      ])

      fireEvent.click(screen.getByRole('checkbox', { name: 'Secret Notes' }))
      await waitFor(() => expect(header(/Secret Notes/)).toBeNull())
    })

    it('starts from the stored choice on the next visit', async () => {
      window.localStorage.setItem(key('u1'), JSON.stringify(['title', 'views']))
      renderWithProviders({ collections: [viewsCollection] })

      expect(await screen.findByText('Article 1')).toBeTruthy()
      expect(header(/Views/)).toBeTruthy()
      expect(header(/Secret Notes/)).toBeNull()
    })

    it('ignores a stored column that is no longer in the config', async () => {
      window.localStorage.setItem(key('u1'), JSON.stringify(['title', 'removedField']))
      renderWithProviders()

      expect(await screen.findByText('Article 1')).toBeTruthy()
      expect(header(/Title/)).toBeTruthy()
      expect(header(/removedField/)).toBeNull()
    })

    it('does not show one user their colleague’s choice', async () => {
      window.localStorage.setItem(key('u1'), JSON.stringify(['title', 'views']))
      renderWithProviders({ collections: [viewsCollection] }, 'u2')

      expect(await screen.findByText('Article 1')).toBeTruthy()
      expect(header(/Views/)).toBeNull()
      expect(header(/Secret Notes/)).toBeTruthy()
    })

    it('does not offer a field the user cannot read', async () => {
      vi.mocked(client.fetchPermissions).mockResolvedValue({
        collections: {
          articles: mockCollectionPerm({ fields: { secretNotes: { read: false } as never } }),
        },
        globals: {},
      })
      renderWithProviders()
      await openPicker()

      await waitFor(() =>
        expect(screen.queryByRole('checkbox', { name: 'Secret Notes' })).toBeNull(),
      )
    })

    it('keeps the title column on', async () => {
      renderWithProviders()
      const title = await openPicker()

      expect(title.hasAttribute('disabled')).toBe(true)
      expect(title.getAttribute('data-state')).toBe('checked')
    })

    it('resets to the default columns', async () => {
      window.localStorage.setItem(key('u1'), JSON.stringify(['title']))
      renderWithProviders()
      await openPicker()
      expect(header(/Secret Notes/)).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))

      await waitFor(() => expect(header(/Secret Notes/)).toBeTruthy())
      expect(window.localStorage.getItem(key('u1'))).toBeNull()
    })

    it('still lists and toggles columns when localStorage throws', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      renderWithProviders({ collections: [viewsCollection] })
      await openPicker()
      expect(header(/Secret Notes/)).toBeTruthy()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Views' }))

      await waitFor(() => expect(header(/Views/)).toBeTruthy())
    })
  })
})
