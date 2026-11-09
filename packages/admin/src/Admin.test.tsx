import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { within, render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { createMemoryHistory } from '@tanstack/react-router'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { Admin } from './Admin'
import { chooseSelectOption } from './test/radix'

const mockConfig: ClientConfig = {
  version: CLIENT_CONFIG_VERSION,
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
  globals: [
    {
      slug: 'header',
      label: 'Site Header',
      fields: [
        { name: 'siteTitle', label: 'Site Title', type: 'text', required: true },
        { name: 'announcement', label: 'Announcement', type: 'text', required: false },
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

  // The sidebar styles its active item from `data-status="active"`, which
  // TanStack Router sets on a matching Link (see layout/Sidebar.tsx). If that
  // attribute stops appearing, the active item loses its styling with no error.
  it('marks only the current section as active in the sidebar', async () => {
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

    const history = createMemoryHistory({ initialEntries: ['/admin/posts'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    const postsLink = await screen.findByRole('link', { name: 'Posts' })
    expect(postsLink.getAttribute('data-status')).toBe('active')
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('data-status')).toBeNull()
  })

  it('formats checkbox, select, and date columns in collection list view', async () => {
    const configWithAllFields: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
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
      globals: [],
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

    // A second filter, this time choosing the column and operator through the
    // Radix Selects rather than accepting their defaults.
    fireEvent.click(screen.getByRole('button', { name: /filters \(1\)/i }))
    chooseSelectOption(screen.getByRole('combobox', { name: 'Filter column' }), 'Views')
    chooseSelectOption(screen.getByRole('combobox', { name: 'Filter operator' }), 'Greater than')
    fireEvent.change(screen.getByLabelText(/filter value/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    await waitFor(() => {
      expect(
        fetchedUrls.some(
          (u) =>
            u.includes('where%5Bviews%5D%5Bgreater_than%5D=5') ||
            u.includes('where[views][greater_than]=5'),
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
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Post' })).toBeTruthy()
    })

    const titleInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^title/i })
    const viewsInput = screen.getByRole<HTMLInputElement>('spinbutton', { name: /^views/i })

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
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByText('Edit Post #42')).toBeTruthy()
      expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
      expect(screen.getByRole('complementary', { name: 'Document sidebar' })).toBeTruthy()
    })

    const titleInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^title/i })

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

    it('clears cached document data on sign out so next user does not see it', async () => {
      let loggedIn = true
      let postsFetchCount = 0

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
            postsFetchCount++
            return mockJsonResponse({
              docs: [
                {
                  id: 1,
                  title: 'Secret Doc',
                  views: 1,
                  createdAt: '2026-11-01T00:00:00.000Z',
                },
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
        expect(screen.getByText('Secret Doc')).toBeTruthy()
      })
      expect(postsFetchCount).toBe(1)

      const signOutBtn = screen.getByRole('button', { name: /sign out/i })
      fireEvent.click(signOutBtn)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in to admin/i })).toBeTruthy()
      })
    })

    it('redirects to target route specified in redirect search parameter upon login', async () => {
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
            return mockJsonResponse({
              docs: [
                {
                  id: 1,
                  title: 'Redirected Post',
                  views: 5,
                  createdAt: '2026-11-01T00:00:00.000Z',
                },
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

      const history = createMemoryHistory({ initialEntries: ['/admin/login?redirect=/posts'] })
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
        expect(screen.getByText('Redirected Post')).toBeTruthy()
      })
    })

    it('redirects to /admin/login when an API call returns 401 unauthorized', async () => {
      let sessionValid = true

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse(
              sessionValid ? { user: mockAuthUser, session: mockAuthSession } : null,
            )
          }
          if (url.includes('/api/posts')) {
            sessionValid = false
            return mockJsonResponse({ message: 'Session expired' }, 401, 'Unauthorized')
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/posts'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in to admin/i })).toBeTruthy()
      })
    })

    it('does not log user out if sign-out API call fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/auth/sign-out') && init?.method === 'POST') {
            return mockJsonResponse({ error: 'Server error' }, 500, 'Internal Server Error')
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
        expect(screen.getByText('Admin User')).toBeTruthy()
        expect(signOutBtn.getAttribute('disabled')).toBeNull()
      })
    })

    it('renders globals navigation and handles global form updates', async () => {
      let savedData: Record<string, unknown> = {
        id: 1,
        siteTitle: 'Initial Title',
        announcement: 'Hello World',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/api/globals/header') && init?.method === 'POST') {
            const body = JSON.parse(init.body as string) as Record<string, unknown>
            savedData = {
              ...savedData,
              ...body,
              updatedAt: '2026-11-01T01:00:00.000Z',
            }
            return mockJsonResponse(savedData)
          }
          if (url.includes('/api/globals/header')) {
            return mockJsonResponse(savedData)
          }
          if (url.includes('/api/posts')) {
            return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/globals/header'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getAllByText('Site Header').length).toBeGreaterThan(0)
      })

      const input = await screen.findByLabelText<HTMLInputElement>(/site title/i)
      await waitFor(() => {
        expect(input.value).toBe('Initial Title')
      })

      fireEvent.change(input, { target: { value: 'Updated Title' } })
      expect(input.value).toBe('Updated Title')

      const saveBtn = screen.getByRole('button', { name: /save changes/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(screen.getByText(/changes saved successfully/i)).toBeTruthy()
      })
    })

    it('resets list view state (search term, filters, page) when navigating between collections', async () => {
      const multiCollectionConfig: ClientConfig = {
        version: CLIENT_CONFIG_VERSION,
        collections: [
          {
            slug: 'posts',
            labels: { singular: 'Post', plural: 'Posts' },
            admin: { useAsTitle: 'title', defaultColumns: ['id', 'title'] },
            fields: [{ name: 'title', label: 'Title', type: 'text', required: true }],
          },
          {
            slug: 'pages',
            labels: { singular: 'Page', plural: 'Pages' },
            admin: { useAsTitle: 'name', defaultColumns: ['id', 'name'] },
            fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
          },
        ],
        globals: [],
      }

      const fetchedUrls: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          fetchedUrls.push(url)
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(multiCollectionConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/api/posts')) {
            return mockJsonResponse({
              docs: [{ id: 1, title: 'First Post' }],
              totalDocs: 1,
              limit: 10,
              page: 1,
              totalPages: 1,
            })
          }
          if (url.includes('/api/pages')) {
            return mockJsonResponse({
              docs: [{ id: 1, name: 'About Page' }],
              totalDocs: 1,
              limit: 10,
              page: 1,
              totalPages: 1,
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

      const searchInput = screen.getByRole<HTMLInputElement>('searchbox', {
        name: /search posts/i,
      })
      fireEvent.change(searchInput, { target: { value: 'First' } })

      await waitFor(() => {
        expect(searchInput.value).toBe('First')
        expect(
          fetchedUrls.some(
            (u) =>
              u.includes('/api/posts') &&
              (u.includes('First') || u.includes('where%5Btitle%5D%5Bcontains%5D=First')),
          ),
        ).toBe(true)
      })

      const pagesNavLink = screen.getByRole('link', { name: 'Pages' })
      fireEvent.click(pagesNavLink)

      await waitFor(() => {
        expect(screen.getByText('About Page')).toBeTruthy()
      })

      const pagesSearchInput = screen.getByRole<HTMLInputElement>('searchbox', {
        name: /search pages/i,
      })
      expect(pagesSearchInput.value).toBe('')

      const pagesUrls = fetchedUrls.filter((u) => u.includes('/api/pages'))
      expect(pagesUrls.length).toBeGreaterThan(0)
      for (const u of pagesUrls) {
        expect(u).not.toContain('First')
        expect(u).not.toContain('where')
      }
    })

    it('resets global view state (success banner and form fields) when navigating between globals', async () => {
      const multiGlobalConfig: ClientConfig = {
        version: CLIENT_CONFIG_VERSION,
        collections: [],
        globals: [
          {
            slug: 'header',
            label: 'Site Header',
            fields: [{ name: 'siteTitle', label: 'Site Title', type: 'text', required: true }],
          },
          {
            slug: 'footer',
            label: 'Site Footer',
            fields: [{ name: 'copyright', label: 'Copyright', type: 'text', required: true }],
          },
        ],
      }

      let savedHeader = { siteTitle: 'Header Title' }
      const savedFooter = { copyright: 'Footer Copyright' }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(multiGlobalConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (
            url.includes('/api/globals/header') &&
            init?.method === 'POST' &&
            typeof init.body === 'string'
          ) {
            savedHeader = JSON.parse(init.body) as { siteTitle: string }
            return mockJsonResponse(savedHeader)
          }
          if (url.includes('/api/globals/header')) {
            return mockJsonResponse(savedHeader)
          }
          if (url.includes('/api/globals/footer')) {
            return mockJsonResponse(savedFooter)
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/globals/header'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getAllByText('Site Header').length).toBeGreaterThan(0)
      })

      const headerInput = await screen.findByLabelText<HTMLInputElement>(/site title/i)
      await waitFor(() => {
        expect(headerInput.value).toBe('Header Title')
      })

      const saveBtn = screen.getByRole('button', { name: /save changes/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(screen.getByText(/changes saved successfully/i)).toBeTruthy()
      })

      const footerNavLink = screen.getByRole('link', { name: 'Site Footer' })
      fireEvent.click(footerNavLink)

      await waitFor(() => {
        expect(screen.getAllByText('Site Footer').length).toBeGreaterThan(0)
      })

      expect(screen.queryByText(/changes saved successfully/i)).toBeNull()

      const footerInput = await screen.findByLabelText<HTMLInputElement>(/copyright/i)
      expect(footerInput.value).toBe('Footer Copyright')
    })

    it('uses collection useAsTitle as default search field instead of id', async () => {
      const searchConfig: ClientConfig = {
        version: CLIENT_CONFIG_VERSION,
        collections: [
          {
            slug: 'articles',
            labels: { singular: 'Article', plural: 'Articles' },
            admin: { useAsTitle: 'headline', defaultColumns: ['headline'] },
            fields: [
              { name: 'headline', label: 'Headline', type: 'text', required: true },
              { name: 'author', label: 'Author', type: 'text', required: true },
            ],
          },
        ],
        globals: [],
      }

      const fetchedUrls: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          fetchedUrls.push(url)
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(searchConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/api/articles')) {
            return mockJsonResponse({
              docs: [{ id: 1, headline: 'Breaking News', author: 'Jane' }],
              totalDocs: 1,
              limit: 10,
              page: 1,
              totalPages: 1,
            })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/articles'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByText('Breaking News')).toBeTruthy()
      })

      const searchInput = screen.getByRole<HTMLInputElement>('searchbox', {
        name: /search articles/i,
      })
      fireEvent.change(searchInput, { target: { value: 'Breaking' } })

      await waitFor(() => {
        expect(
          fetchedUrls.some(
            (u) =>
              u.includes('/api/articles') &&
              decodeURIComponent(u).includes('where[headline][contains]=Breaking'),
          ),
        ).toBe(true)
        expect(
          fetchedUrls.some(
            (u) => u.includes('/api/articles') && decodeURIComponent(u).includes('where[id]'),
          ),
        ).toBe(false)
      })
    })

    it('clearing optional upload-doc fields sends empty string in FormData', async () => {
      const uploadConfig: ClientConfig = {
        version: CLIENT_CONFIG_VERSION,
        collections: [
          {
            slug: 'media',
            labels: { singular: 'Media', plural: 'Media' },
            admin: { useAsTitle: 'filename', defaultColumns: ['filename'] },
            upload: true,
            fields: [
              { name: 'alt', label: 'Alt text', type: 'text', required: false },
              { name: 'caption', label: 'Caption', type: 'text', required: false },
            ],
          },
        ],
        globals: [],
      }

      let capturedBody: unknown = null
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(uploadConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/api/media/10') && init?.method === 'PATCH') {
            capturedBody = init.body
            return mockJsonResponse({
              id: 10,
              filename: 'pic.png',
              alt: null,
              caption: '',
            })
          }
          if (url.includes('/api/media/10')) {
            return mockJsonResponse({
              id: 10,
              filename: 'pic.png',
              alt: 'Initial Alt',
              caption: 'Initial Caption',
            })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/media/10'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByText('Edit Media #10')).toBeTruthy()
      })

      const altInput = await screen.findByLabelText<HTMLInputElement>(/alt text/i)
      await waitFor(() => {
        expect(altInput.value).toBe('Initial Alt')
      })

      // Clear the alt field
      fireEvent.change(altInput, { target: { value: '' } })
      expect(altInput.value).toBe('')

      const saveBtn = screen.getByRole('button', { name: /save changes/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(screen.getByText(/saved successfully!/i)).toBeTruthy()
      })

      expect(capturedBody).toBeInstanceOf(FormData)
      if (capturedBody instanceof FormData) {
        expect(capturedBody.get('alt')).toBe('')
      }
    })

    it('does not overwrite dirty form edits when refetch occurs in edit mode', async () => {
      let fetchCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/api/posts/42')) {
            fetchCount++
            return mockJsonResponse({
              id: 42,
              title: fetchCount === 1 ? 'Original Title' : 'Server Refetched Title',
              views: 100,
            })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/posts/42'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      const titleInput = await screen.findByLabelText<HTMLInputElement>(/title/i)
      await waitFor(() => {
        expect(titleInput.value).toBe('Original Title')
      })

      // User types into the form, making it dirty
      fireEvent.change(titleInput, { target: { value: 'User Edited Title' } })
      expect(titleInput.value).toBe('User Edited Title')

      // Trigger window focus event
      window.dispatchEvent(new Event('focus'))

      // Title must remain user's edit, not reset to server data
      await waitFor(() => {
        expect(titleInput.value).toBe('User Edited Title')
      })
    })

    it('renders delete error alert when deleting document in list view fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (url.includes('/api/posts/1') && init?.method === 'DELETE') {
            return mockJsonResponse(
              { error: 'You do not have permission to delete this post' },
              403,
              'Forbidden',
            )
          }
          if (url.includes('/api/posts')) {
            return mockJsonResponse({
              docs: [{ id: 1, title: 'Sample Post', views: 50 }],
              totalDocs: 1,
              limit: 10,
              page: 1,
              totalPages: 1,
            })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/posts'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByText('Sample Post')).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog.textContent).toContain('Are you sure you want to delete this document?')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        const errorAlert = screen.getByTestId('delete-error-alert')
        expect(errorAlert.textContent).toContain('You do not have permission to delete this post')
      })
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    it('does not delete when the confirmation dialog is cancelled', async () => {
      const deleteCalls: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/_lontar/config')) {
            return mockJsonResponse(mockConfig)
          }
          if (url.includes('/auth/get-session')) {
            return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
          }
          if (init?.method === 'DELETE') {
            deleteCalls.push(url)
            return mockJsonResponse({ id: 1 })
          }
          if (url.includes('/api/posts')) {
            return mockJsonResponse({
              docs: [{ id: 1, title: 'Sample Post', views: 50 }],
              totalDocs: 1,
              limit: 10,
              page: 1,
              totalPages: 1,
            })
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/posts'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByText('Sample Post')).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
      const dialog = await screen.findByRole('alertdialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull()
      })
      expect(deleteCalls).toEqual([])
      expect(screen.getByText('Sample Post')).toBeTruthy()
    })

    it('does not render empty state when list query fails with an error', async () => {
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
            return mockJsonResponse(
              { error: 'Failed to fetch posts from database' },
              500,
              'Internal Server Error',
            )
          }
          return Promise.reject(new Error(`Unhandled URL: ${url}`))
        }),
      )

      const history = createMemoryHistory({ initialEntries: ['/admin/posts'] })
      render(<Admin apiBase="/api" basePath="/admin" history={history} />)

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch posts from database')).toBeTruthy()
      })

      // The empty state "Create the first post" should NOT be rendered
      expect(screen.queryByText(/create the first post/i)).toBeNull()
      expect(screen.queryByText(/no posts found/i)).toBeNull()
    })
  })
})

// docs/adr/0020: system by default, an explicit choice sets data-theme on the
// wrapper and persists under a prefixed localStorage key.
describe('Admin theme', () => {
  const KEY = 'lontar-admin-theme'

  function stubAuthenticatedFetch() {
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
  }

  function renderDashboard() {
    const history = createMemoryHistory({ initialEntries: ['/admin'] })
    return render(<Admin apiBase="/api" basePath="/admin" history={history} />)
  }

  function wrapper(container: HTMLElement): HTMLElement {
    const el = container.querySelector<HTMLElement>('.lontar-admin')
    if (!el) throw new Error('.lontar-admin wrapper not rendered')
    return el
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('follows the system by default: no data-theme and System pressed', async () => {
    stubAuthenticatedFetch()
    const { container } = renderDashboard()

    const system = await screen.findByRole('button', { name: 'System' })
    expect(system.getAttribute('aria-pressed')).toBe('true')
    expect(wrapper(container).hasAttribute('data-theme')).toBe(false)
  })

  it('applies and stores an explicit choice, and clears it for System', async () => {
    stubAuthenticatedFetch()
    const { container } = renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: 'Dark' }))
    expect(wrapper(container).getAttribute('data-theme')).toBe('dark')
    expect(window.localStorage.getItem(KEY)).toBe('dark')
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(wrapper(container).getAttribute('data-theme')).toBe('light')
    expect(window.localStorage.getItem(KEY)).toBe('light')

    fireEvent.click(screen.getByRole('button', { name: 'System' }))
    expect(wrapper(container).hasAttribute('data-theme')).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('restores a stored choice on load, and writes no other storage keys', async () => {
    window.localStorage.setItem(KEY, 'dark')
    stubAuthenticatedFetch()
    const { container } = renderDashboard()

    await screen.findByRole('button', { name: 'Dark' })
    expect(wrapper(container).getAttribute('data-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
    expect(Object.keys(window.localStorage)).toEqual([KEY])
  })

  it('ignores a stored value it does not recognise', async () => {
    window.localStorage.setItem(KEY, 'sepia')
    stubAuthenticatedFetch()
    const { container } = renderDashboard()

    const system = await screen.findByRole('button', { name: 'System' })
    expect(system.getAttribute('aria-pressed')).toBe('true')
    expect(wrapper(container).hasAttribute('data-theme')).toBe(false)
  })

  it('still switches theme when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    stubAuthenticatedFetch()
    const { container } = renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: 'Dark' }))
    expect(wrapper(container).getAttribute('data-theme')).toBe('dark')
  })
})
