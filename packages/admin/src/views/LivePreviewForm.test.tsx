import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory } from '@tanstack/react-router'
import { Admin } from '../Admin'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'

const mockAuthUser = {
  id: 'user-1',
  name: 'Admin User',
  email: 'admin@example.com',
  role: 'admin',
}

const mockAuthSession = {
  id: 'session-1',
  userId: 'user-1',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
}

const mockConfigWithPreview: ClientConfig = {
  version: CLIENT_CONFIG_VERSION,
  collections: [
    {
      slug: 'articles',
      labels: { singular: 'Article', plural: 'Articles' },
      admin: {
        useAsTitle: 'title',
        defaultColumns: ['title', 'slug'],
        preview: {
          url: 'https://example.com/posts/{slug}?preview=1',
        },
      },
      versions: {
        drafts: true,
      },
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'slug', label: 'Slug', type: 'text', required: true },
        { name: 'content', label: 'Content', type: 'textarea', required: false },
      ],
    },
  ],
  globals: [],
}

function mockJsonResponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('Live preview form integration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('toggles live preview pane and renders iframe when tokens are filled', async () => {
    const existingDoc = {
      id: 1,
      title: 'Hello World',
      slug: 'hello-world',
      content: 'Sample content',
      _status: 'draft',
      _isPublished: false,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithPreview)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/1')) {
          return mockJsonResponse(existingDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/articles/1'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Live Preview' })).toBeTruthy()
    })

    // Click Live Preview button
    fireEvent.click(screen.getByRole('button', { name: 'Live Preview' }))

    // Preview pane is open and renders iframe with resolved url
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Hide Preview' })).toBeTruthy()
      const iframe = screen.getByTitle<HTMLIFrameElement>('Live Preview')
      expect(iframe).toBeTruthy()
      expect(iframe.src).toBe('https://example.com/posts/hello-world?preview=1')
    })

    // Click Hide Preview button
    fireEvent.click(screen.getByRole('button', { name: 'Hide Preview' }))

    await waitFor(() => {
      expect(screen.queryByTitle('Live Preview')).toBeNull()
      expect(screen.getByRole('button', { name: 'Live Preview' })).toBeTruthy()
    })
  })

  it('displays pending message when required tokens are missing and resolves after saving', async () => {
    let currentDoc = {
      id: 2,
      title: 'Post Without Slug',
      slug: '',
      content: 'No slug yet',
      _status: 'draft',
      _isPublished: false,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithPreview)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/2/versions')) {
          return mockJsonResponse({ docs: [], totalDocs: 0, page: 1, totalPages: 1 })
        }
        if (url.includes('/api/articles/2')) {
          if (init?.method === 'PATCH' || init?.method === 'PUT') {
            currentDoc = { ...currentDoc, slug: 'my-new-slug' }
            return mockJsonResponse(currentDoc)
          }
          return mockJsonResponse(currentDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/articles/2'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Live Preview' })).toBeTruthy()
    })

    // Open preview
    fireEvent.click(screen.getByRole('button', { name: 'Live Preview' }))

    // Pending placeholder is visible
    await waitFor(() => {
      expect(screen.getByText('Preview pending')).toBeTruthy()
      expect(screen.getByText(/Fill in "slug" to start live preview\./i)).toBeTruthy()
    })

    // Fill in slug in the form
    const slugInput = screen.getByRole('textbox', { name: /Slug/i })
    act(() => {
      fireEvent.change(slugInput, { target: { value: 'my-new-slug' } })
    })

    // Live form values change, but iframe does not load onto an unsaved URL
    await waitFor(() => {
      expect(screen.getByText('Save to start live preview.')).toBeTruthy()
      expect(screen.queryByTitle('Live Preview')).toBeNull()
    })

    // Click Publish
    const publishBtn = screen.getByRole('button', { name: 'Publish' })
    fireEvent.click(publishBtn)

    // Once saved, iframe is rendered with the new slug
    await waitFor(() => {
      expect(screen.queryByText('Preview pending')).toBeNull()
      const iframe = screen.getByTitle<HTMLIFrameElement>('Live Preview')
      expect(iframe.src).toBe('https://example.com/posts/my-new-slug?preview=1')
    })
  })

  it('renders EditorPreviewToggle and data-testid="field-column" when preview is open', async () => {
    const existingDoc = {
      id: 3,
      title: 'Layout Test',
      slug: 'layout-test',
      content: 'Sample content',
      _status: 'draft',
      _isPublished: false,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithPreview)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/3')) {
          return mockJsonResponse(existingDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/articles/3'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByTestId('field-column')).toBeTruthy()
    })
    const fieldCol = screen.getByTestId('field-column')
    expect(fieldCol.className).toContain('lt:@3xl:max-w-[760px]')

    // Toggle not rendered when preview is closed
    expect(screen.queryByRole('tablist', { name: 'Editor view' })).toBeNull()

    // Open live preview
    fireEvent.click(screen.getByRole('button', { name: 'Live Preview' }))

    await waitFor(() => {
      expect(screen.getByRole('tablist', { name: 'Editor view' })).toBeTruthy()
    })

    const editTab = screen.getByRole('tab', { name: 'Edit' })
    const previewTab = screen.getByRole('tab', { name: 'Preview' })

    // On narrow viewports, clicking Preview tab switches active view
    fireEvent.click(previewTab)
    expect(previewTab.getAttribute('aria-selected')).toBe('true')
    expect(editTab.getAttribute('aria-selected')).toBe('false')

    fireEvent.click(editTab)
    expect(editTab.getAttribute('aria-selected')).toBe('true')
    expect(previewTab.getAttribute('aria-selected')).toBe('false')
  })
})
