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

const mockAuthUser = {
  id: 'user-1',
  name: 'Admin User',
  email: 'admin@example.com',
}

const mockAuthSession = {
  id: 'session-1',
  userId: 'user-1',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
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

  it('renders dashboard and sidebar when authenticated and config is loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
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
      expect(screen.getByText('Admin User')).toBeTruthy()
      expect(screen.getByText('admin@example.com')).toBeTruthy()
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
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
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

  it('formats checkbox, select, and date columns in collection list view', async () => {
    const configWithAllFields: ClientConfig = {
      version: 1,
      collections: [
        {
          slug: 'articles',
          labels: { singular: 'Article', plural: 'Articles' },
          admin: {
            useAsTitle: 'title',
            defaultColumns: ['title', 'featured', 'status', 'publishedAt'],
          },
          fields: [
            { name: 'title', label: 'Title', type: 'text', required: true },
            { name: 'featured', label: 'Featured', type: 'checkbox', required: false },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: [
                { label: 'Draft', value: 'draft' },
                { label: 'Published', value: 'published' },
              ],
              required: true,
            },
            { name: 'publishedAt', label: 'Published At', type: 'date', required: false },
          ],
        },
      ],
    }

    const mockArticles = [
      {
        id: 1,
        title: 'Article 1',
        featured: true,
        status: 'published',
        publishedAt: '2026-11-01T12:00:00.000Z',
      },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(configWithAllFields)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles')) {
          return mockJsonResponse({
            docs: mockArticles,
            totalDocs: 1,
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

    const history = createMemoryHistory({ initialEntries: ['/admin/articles'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByText('Article 1')).toBeTruthy()
      expect(screen.getByText('true')).toBeTruthy()
      expect(screen.getByText('Published')).toBeTruthy()
    })
  })

  it('filters documents via search input and column filter in collection list view', async () => {
    const fetchedUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        fetchedUrls.push(url)
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/posts')) {
          return mockJsonResponse({
            docs: [
              { id: 1, title: 'First Post', views: 42, createdAt: '2026-10-31T00:00:00.000Z' },
            ],
            totalDocs: 1,
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
    })

    // Type in search input
    const searchInput = screen.getByRole('searchbox', { name: /search posts/i })
    fireEvent.change(searchInput, { target: { value: 'First' } })

    await waitFor(() => {
      expect(
        fetchedUrls.some(
          (u) =>
            u.includes('where%5Btitle%5D%5Bcontains%5D=First') ||
            u.includes('where[title][contains]=First'),
        ),
      ).toBe(true)
    })

    // Click Add Filter button to open filter form
    const filterBtn = screen.getByRole('button', { name: /add filter/i })
    fireEvent.click(filterBtn)

    // Enter filter value and apply
    const filterValueInput = screen.getByLabelText(/filter value/i)
    fireEvent.change(filterValueInput, { target: { value: '10' } })

    const applyBtn = screen.getByRole('button', { name: /apply/i })
    fireEvent.click(applyBtn)

    await waitFor(() => {
      expect(
        fetchedUrls.some(
          (u) =>
            u.includes('where%5Btitle%5D%5Bcontains%5D=10') ||
            u.includes('where[title][contains]=10'),
        ),
      ).toBe(true)
    })
  })

  it('toggles column sorting on column header click', async () => {
    const fetchedUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        fetchedUrls.push(url)
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/posts')) {
          return mockJsonResponse({
            docs: [
              { id: 1, title: 'First Post', views: 42, createdAt: '2026-10-31T00:00:00.000Z' },
            ],
            totalDocs: 1,
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
    })

    // Find the Title column header and click it
    const titleHeader1 = screen.getByRole('columnheader', { name: /title/i })
    fireEvent.click(titleHeader1)

    await waitFor(() => {
      expect(fetchedUrls.some((u) => u.includes('sort=title'))).toBe(true)
      expect(screen.getByText('First Post')).toBeTruthy()
    })

    // Query fresh header element after re-render and click again for descending sort
    const titleHeader2 = screen.getByRole('columnheader', { name: /title/i })
    fireEvent.click(titleHeader2)

    await waitFor(() => {
      expect(fetchedUrls.some((u) => u.includes('sort=-title'))).toBe(true)
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
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
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
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
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

  describe('Authentication and Route Protection', () => {
    it('redirects unauthenticated users to /admin/login from protected routes', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse(null)
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in to admin/i })).toBeTruthy()
        expect(screen.getByLabelText(/email/i)).toBeTruthy()
        expect(screen.getByLabelText(/password/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy()
      })
    })

    it('displays error message when login credentials fail', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse(null)
          }
          if (url.includes('/auth/sign-in/email') && init?.method === 'POST') {
            return mockJsonResponse({ message: 'Invalid email or password' }, 401, 'Unauthorized')
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/login'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in to admin/i })).toBeTruthy()
      })

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'wrong@example.com' },
      })
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'wrongpass' },
      })
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeTruthy()
        expect(screen.getByText('Invalid email or password')).toBeTruthy()
      })
    })

    it('successfully logs in and navigates to dashboard', async () => {
      let loggedIn = false

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse(
              loggedIn ? { user: mockAuthUser, session: mockAuthSession } : null,
            )
          }
          if (url.includes('/auth/sign-in/email') && init?.method === 'POST') {
            loggedIn = true
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/api/posts')) {
            return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/login'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in to admin/i })).toBeTruthy()
      })

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'admin@example.com' },
      })
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'correctpassword' },
      })
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
        expect(screen.getByText('Admin User')).toBeTruthy()
      })
    })

    it('redirects already authenticated users away from /admin/login to dashboard', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/api/posts')) {
            return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/login'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
        expect(screen.getByText('Admin User')).toBeTruthy()
      })
    })

    it('signs out and redirects to /admin/login when clicking logout button', async () => {
      let loggedIn = true

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse(
              loggedIn ? { user: mockAuthUser, session: mockAuthSession } : null,
            )
          }
          if (url.includes('/auth/sign-out') && init?.method === 'POST') {
            loggedIn = false
            return mockJsonResponse({ success: true })
          }
          if (url.includes('/api/posts')) {
            return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByText('Admin User')).toBeTruthy()
      })

      const signOutBtn = screen.getByRole('button', { name: /sign out/i })
      fireEvent.click(signOutBtn)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in to admin/i })).toBeTruthy()
      })
    })
  })
})
