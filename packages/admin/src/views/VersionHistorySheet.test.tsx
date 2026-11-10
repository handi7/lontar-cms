import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ClientCollection, ClientGlobal, ClientPaginatedVersions } from '@lontar/core/client'
import { PortalContainerProvider } from '../context/PortalContainer'
import { VersionHistorySheet } from './VersionHistorySheet'

const mockGlobal: ClientGlobal = {
  slug: 'settings',
  label: 'Settings',
  versions: { drafts: true },
  fields: [{ name: 'title', label: 'Title', type: 'text', required: true }],
}

const mockCollection: ClientCollection = {
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  versions: { drafts: true },
  admin: { useAsTitle: 'title', defaultColumns: ['title'] },
  fields: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'content', label: 'Content', type: 'textarea', required: false },
  ],
}

const mockVersions: ClientPaginatedVersions = {
  docs: [
    {
      id: 2,
      parentId: 1,
      versionNumber: 2,
      autosave: false,
      snapshot: {
        id: 1,
        title: 'Updated Title',
        content: 'Updated Body',
        _status: 'published',
      },
      _status: 'published',
      createdAt: '2026-11-09T10:00:00.000Z',
      createdBy: 'editor@example.com',
    },
    {
      id: 1,
      parentId: 1,
      versionNumber: 1,
      autosave: false,
      snapshot: {
        id: 1,
        title: 'Original Title',
        content: 'Original Body',
        _status: 'draft',
      },
      _status: 'draft',
      createdAt: '2026-11-09T09:00:00.000Z',
      createdBy: null,
    },
  ],
  totalDocs: 2,
  limit: 10,
  page: 1,
  totalPages: 1,
}

function mockJsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function renderVersionHistorySheet(
  props: Partial<React.ComponentProps<typeof VersionHistorySheet>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <div className="lontar-admin">
      <PortalContainerProvider>
        <QueryClientProvider client={queryClient}>
          <VersionHistorySheet
            open={true}
            onOpenChange={vi.fn()}
            apiBase="http://localhost:3000/api"
            collection={mockCollection}
            id={1}
            currentDoc={{
              id: 1,
              title: 'Current Title',
              content: 'Updated Body',
              _status: 'draft',
            }}
            {...props}
          />
        </QueryClientProvider>
      </PortalContainerProvider>
    </div>,
  )
}

describe('VersionHistorySheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(cleanup)

  it('renders version list and diff viewer with initial selection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/posts/1/versions')) {
          return mockJsonResponse(mockVersions)
        }
        return mockJsonResponse({}, 404)
      }),
    )

    renderVersionHistorySheet()

    // Sheet header
    expect(screen.getByText('Version History')).toBeTruthy()

    // Waits for versions to load
    await waitFor(() => {
      expect(screen.getByText('v2')).toBeTruthy()
      expect(screen.getByText('v1')).toBeTruthy()
    })

    // Badges
    expect(screen.getByText('Published')).toBeTruthy()
    expect(screen.getByText('by editor@example.com')).toBeTruthy()

    // By default first version (v2) is selected and compared with currentDoc
    // v2 snapshot has title: "Updated Title", currentDoc has title: "Current Title"
    expect(screen.getByText(/Comparing v2 against Current State/i)).toBeTruthy()
    expect(screen.getByText('Title')).toBeTruthy()
    expect(screen.getByText('Updated Title')).toBeTruthy()
    expect(screen.getByText('Current Title')).toBeTruthy()
  })

  it('allows toggling expand width', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/posts/1/versions')) {
          return mockJsonResponse(mockVersions)
        }
        return mockJsonResponse({}, 404)
      }),
    )

    renderVersionHistorySheet()

    await waitFor(() => {
      expect(screen.getByText('v2')).toBeTruthy()
    })

    const expandBtn = screen.getByRole('button', { name: 'Expand width' })
    expect(expandBtn).toBeTruthy()
    fireEvent.click(expandBtn)

    expect(screen.getByRole('button', { name: 'Collapse width' })).toBeTruthy()
  })

  it('switches selected version when clicking another version in the list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/posts/1/versions')) {
          return mockJsonResponse(mockVersions)
        }
        return mockJsonResponse({}, 404)
      }),
    )

    renderVersionHistorySheet()

    await waitFor(() => {
      expect(screen.getByText('v2')).toBeTruthy()
      expect(screen.getByText('v1')).toBeTruthy()
    })

    // Initially comparing v2 against Current State
    expect(screen.getByText(/Comparing v2 against Current State/i)).toBeTruthy()

    // Click on v1 button in the list
    const v1Btn = screen.getByText('v1').closest('button')!
    fireEvent.click(v1Btn)

    // Now comparing v1 against Current State
    await waitFor(() => {
      expect(screen.getByText(/Comparing v1 against Current State/i)).toBeTruthy()
      expect(screen.getByText('Original Title')).toBeTruthy()
      expect(screen.getByText('Original Body')).toBeTruthy()
    })
  })

  it('opens confirm restore dialog and calls restore endpoint on confirmation', async () => {
    const onRestoreSuccess = vi.fn()
    const onOpenChange = vi.fn()
    let restoreCalled = false

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/api/posts/1/versions/2/restore') && init?.method === 'POST') {
          restoreCalled = true
          return mockJsonResponse({
            id: 1,
            title: 'Updated Title',
            content: 'Updated Body',
            _status: 'draft',
          })
        }
        if (url.includes('/api/posts/1/versions')) {
          return mockJsonResponse(mockVersions)
        }
        return mockJsonResponse({}, 404)
      }),
    )

    renderVersionHistorySheet({ onRestoreSuccess, onOpenChange })

    await waitFor(() => {
      expect(screen.getByText('v2')).toBeTruthy()
    })

    // Click Restore v2 button in diff viewer header
    const restoreBtn = screen.getByRole('button', { name: /Restore v2/i })
    fireEvent.click(restoreBtn)

    // Confirm dialog appears
    expect(screen.getByText('Restore version #2?')).toBeTruthy()

    // Click Restore in confirmation dialog
    const confirmBtn = screen.getByRole('button', { name: 'Restore' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(restoreCalled).toBe(true)
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onRestoreSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated Title' }),
      )
    })
  })

  it('supports version history for globals', async () => {
    let restoreCalled = false
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/api/globals/settings/versions/2/restore') && init?.method === 'POST') {
          restoreCalled = true
          return mockJsonResponse({
            title: 'Updated Global Title',
            _status: 'draft',
          })
        }
        if (url.includes('/api/globals/settings/versions')) {
          return mockJsonResponse(mockVersions)
        }
        return mockJsonResponse({}, 404)
      }),
    )

    renderVersionHistorySheet({
      collection: undefined,
      global: mockGlobal,
      id: undefined,
      currentDoc: { title: 'Current Title' },
    })

    await waitFor(() => {
      expect(screen.getByText('v2')).toBeTruthy()
    })

    const restoreBtn = screen.getByRole('button', { name: /Restore v2/i })
    fireEvent.click(restoreBtn)

    expect(screen.getByText('Restore version #2?')).toBeTruthy()
    const confirmBtn = screen.getByRole('button', { name: 'Restore' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(restoreCalled).toBe(true)
    })
  })
})
