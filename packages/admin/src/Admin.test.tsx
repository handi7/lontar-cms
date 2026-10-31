import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { createMemoryHistory } from '@tanstack/react-router'
import type { ClientConfig } from '@lontar/core/client'
import { Admin } from './Admin'

const mockConfig: ClientConfig = {
  version: 1,
  collections: [
    {
      slug: 'posts',
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title', defaultColumns: ['id', 'title', 'views', 'createdAt'] },
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'views', label: 'Views', type: 'number', required: false },
      ],
    },
  ],
}

function mockJsonResponse(data: unknown, status = 200, statusText = 'OK'): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      statusText,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('Admin SPA', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders loading state while fetching config', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
    )

    render(<Admin apiBase="/api" basePath="/admin" />)
    expect(screen.getByText(/loading lontar cms configuration/i)).toBeTruthy()
  })

  it('renders error state when config fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValue(
          mockJsonResponse({ error: 'Database connection failed' }, 500, 'Internal Server Error'),
        ),
    )

    render(<Admin apiBase="/api" basePath="/admin" />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load admin configuration/i)).toBeTruthy()
      expect(screen.getByText(/database connection failed/i)).toBeTruthy()
    })
  })

  it('renders dashboard and sidebar when config is loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByText('Lontar CMS')).toBeTruthy()
      expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Posts').length).toBeGreaterThan(0)
    })
  })

  it('renders collection list view with documents', async () => {
    const mockPosts = [
      { id: 1, title: 'First Post', views: 42, createdAt: '2026-10-31T12:00:00.000Z' },
      { id: 2, title: 'Second Post', views: 100, createdAt: '2026-10-31T13:00:00.000Z' },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        if (url.includes('/api/posts')) {
          return mockJsonResponse({
            docs: mockPosts,
            totalDocs: 2,
            limit: 10,
            page: 1,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          })
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/posts'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByText('First Post')).toBeTruthy()
      expect(screen.getByText('Second Post')).toBeTruthy()
      expect(screen.getByText('42')).toBeTruthy()
      expect(screen.getByText('100')).toBeTruthy()
    })
  })

  it('renders create form and submits new document', async () => {
    const postMock = vi.fn((_url: string, _init?: RequestInit) => {
      return mockJsonResponse({ id: 3, title: 'Brand New Post', views: 10 })
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        if (url.endsWith('/api/posts') && init?.method === 'POST') {
          return postMock(url, init)
        }
        if (url.includes('/api/posts')) {
          return mockJsonResponse({
            docs: [],
            totalDocs: 0,
            limit: 10,
            page: 1,
            totalPages: 1,
          })
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/posts/create'] })
    const { container } = render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Post' })).toBeTruthy()
    })

    const titleInput = container.querySelector('input#title') as HTMLInputElement
    const viewsInput = container.querySelector('input#views') as HTMLInputElement
    expect(titleInput).toBeTruthy()
    expect(viewsInput).toBeTruthy()

    fireEvent.change(titleInput, { target: { value: 'Brand New Post' } })
    fireEvent.change(viewsInput, { target: { value: '10' } })

    const submitBtn = screen.getByRole('button', { name: /create post/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1)
    })

    const callArgs = postMock.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(callArgs[1].body as string) as Record<string, unknown>
    expect(sentBody).toEqual({
      title: 'Brand New Post',
      views: 10,
    })
  })

  it('renders edit form with preloaded document and saves updates', async () => {
    const existingDoc = {
      id: 42,
      title: 'Existing Post',
      views: 99,
      createdAt: '2026-10-31T12:00:00.000Z',
      updatedAt: '2026-10-31T12:00:00.000Z',
    }

    const patchMock = vi.fn((_url: string, _init?: RequestInit) => {
      return mockJsonResponse({ ...existingDoc, title: 'Updated Title' })
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        if (url.endsWith('/api/posts/42') && init?.method === 'PATCH') {
          return patchMock(url, init)
        }
        if (url.endsWith('/api/posts/42')) {
          return mockJsonResponse(existingDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/posts/42'] })
    const { container } = render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByText('Edit Post #42')).toBeTruthy()
    })

    const titleInput = container.querySelector('input#title') as HTMLInputElement
    expect(titleInput).toBeTruthy()

    await waitFor(() => {
      expect(titleInput.value).toBe('Existing Post')
    })

    fireEvent.change(titleInput, { target: { value: 'Updated Title' } })

    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/saved successfully!/i)).toBeTruthy()
    })

    const callArgs = patchMock.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(callArgs[1].body as string) as Record<string, unknown>
    expect(sentBody.title).toBe('Updated Title')
  })
})
