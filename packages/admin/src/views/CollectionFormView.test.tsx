import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  CLIENT_CONFIG_VERSION,
  type ClientCollection,
  type ClientConfig,
  type CollectionPermission,
} from '@lontar/core/client'
import { PortalContainerProvider } from '../context/PortalContainer'
import { CollectionFormView } from './CollectionFormView'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'
import { PermissionsProvider } from '../context/PermissionsContext'
import { AdminContext } from '../context/AdminContext'

let mockRouteParams: { collection?: string; id?: string } = {
  collection: 'articles',
  id: '1',
}

vi.mock('@tanstack/react-router', () => ({
  useParams: () => mockRouteParams,
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    fetchDoc: vi.fn(),
    fetchDocVersions: vi.fn(),
    fetchPermissions: vi.fn(),
    fetchDocumentPermissions: vi.fn(),
    createDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
  }
})

const mockCollection: ClientCollection = {
  slug: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title'],
  },
  versions: {
    drafts: true,
  },
  fields: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'secretField', label: 'Secret Field', type: 'text', required: false },
    { name: 'roleRestricted', label: 'Role Restricted', type: 'text', required: false },
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

describe('CollectionFormView permissions (#341)', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteParams = { collection: 'articles', id: '1' }
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    vi.mocked(client.fetchDoc).mockResolvedValue({
      id: 1,
      title: 'Existing Article',
      secretField: 'Hidden Value',
      roleRestricted: 'Locked Value',
      _status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    vi.mocked(client.fetchDocVersions).mockResolvedValue({
      docs: [],
      totalDocs: 0,
      limit: 10,
      page: 1,
      totalPages: 1,
    })

    vi.mocked(client.fetchDocumentPermissions).mockResolvedValue(mockCollectionPerm())
  })

  afterEach(cleanup)

  function renderView(mode: 'create' | 'edit') {
    const adminConfig: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
      collections: [mockCollection],
      globals: [],
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
                <CollectionFormView mode={mode} />
              </PermissionsProvider>
            </AdminContext.Provider>
          </QueryClientProvider>
        </PortalContainerProvider>
      </div>,
    )
  }

  it('renders NotFoundView when user cannot create in collection', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm({ create: false }),
      },
      globals: {},
    })

    renderView('create')

    expect(await screen.findByText('Page Not Found')).toBeTruthy()
  })

  it('renders NotFoundView when user cannot read collection in edit mode', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm({ read: false }),
      },
      globals: {},
    })

    renderView('edit')

    expect(await screen.findByText('Page Not Found')).toBeTruthy()
  })

  it('renders NotFoundView when document-level read permission is false', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm(),
      },
      globals: {},
    })

    vi.mocked(client.fetchDocumentPermissions).mockResolvedValue(
      mockCollectionPerm({ read: false, update: false, delete: false }),
    )

    renderView('edit')

    expect(await screen.findByText('Page Not Found')).toBeTruthy()
  })

  it('renders view-only form when update is false on document permissions', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm(),
      },
      globals: {},
    })

    vi.mocked(client.fetchDocumentPermissions).mockResolvedValue(
      mockCollectionPerm({ read: true, update: false, delete: false }),
    )

    renderView('edit')

    // Title field input should be disabled
    const titleInput = await screen.findByLabelText<HTMLInputElement>(/Title/i)
    expect(titleInput.disabled).toBe(true)

    // Padlock icons should be rendered for disabled fields
    expect(screen.getByTestId('locked-icon-title')).toBeTruthy()

    // Submit and publish buttons should NOT be present in DocumentSidebar
    expect(screen.queryByRole('button', { name: /Publish/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Save Draft/i })).toBeNull()

    // Delete button should NOT be present
    expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull()
  })

  it('hides unreadable field and locks read-only field', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm({
          fields: {
            title: { read: true, create: true, update: true },
            secretField: { read: false, create: false, update: false },
            roleRestricted: { read: true, create: false, update: false },
          },
        }),
      },
      globals: {},
    })

    vi.mocked(client.fetchDocumentPermissions).mockResolvedValue(
      mockCollectionPerm({
        fields: {
          title: { read: true, create: true, update: true },
          secretField: { read: false, create: false, update: false },
          roleRestricted: { read: true, create: false, update: false },
        },
      }),
    )

    renderView('edit')

    // Title is normal and enabled
    const titleInput = await screen.findByLabelText<HTMLInputElement>(/Title/i)
    expect(titleInput.disabled).toBe(false)
    expect(screen.queryByTestId('locked-icon-title')).toBeNull()

    // Secret field is NOT rendered (read: false)
    expect(screen.queryByLabelText(/Secret Field/i)).toBeNull()

    // Role restricted is read-only (update: false)
    const roleRestrictedInput = screen.getByLabelText<HTMLInputElement>(/Role Restricted/i)
    expect(roleRestrictedInput.disabled).toBe(true)
    expect(screen.getByTestId('locked-icon-roleRestricted')).toBeTruthy()

    // Document sidebar allows Publish because doc update: true
    expect(screen.getByRole('button', { name: /^Publish$/ })).toBeTruthy()
  })

  it('hides delete button when document-level delete is false', async () => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: {
        articles: mockCollectionPerm(),
      },
      globals: {},
    })

    vi.mocked(client.fetchDocumentPermissions).mockResolvedValue(
      mockCollectionPerm({ read: true, update: true, delete: false }),
    )

    renderView('edit')

    // Document should be editable
    const titleInput = await screen.findByLabelText<HTMLInputElement>(/Title/i)
    expect(titleInput.disabled).toBe(false)
    expect(screen.getByRole('button', { name: /^Publish$/ })).toBeTruthy()

    // But delete button should be hidden
    expect(screen.queryByRole('button', { name: /Delete Article/i })).toBeNull()
  })
})
