import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory } from '@tanstack/react-router'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { Admin } from '../Admin'

const mockConfigWithAutosave: ClientConfig = {
  version: CLIENT_CONFIG_VERSION,
  collections: [
    {
      slug: 'articles',
      labels: { singular: 'Article', plural: 'Articles' },
      versions: {
        drafts: true,
        autosave: { interval: 500 },
      },
      admin: { useAsTitle: 'title', defaultColumns: ['title'] },
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'content', label: 'Content', type: 'textarea', required: false },
      ],
    },
  ],
  globals: [],
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

function mockJsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('Autosave in edit form (#203)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('triggers debounced autosave when form is dirty and valid, updating the sidebar indicator', async () => {
    const existingDoc = {
      id: 1,
      title: 'Original Title',
      content: 'Original content',
      _status: 'draft',
      _isPublished: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const requests: { url: string; method: string }[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithAutosave)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/1') && init?.method === 'PATCH') {
          requests.push({ url, method: 'PATCH' })
          return mockJsonResponse({
            ...existingDoc,
            title: 'Updated Autosaved Title',
          })
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
      expect(screen.getByRole('textbox', { name: /Title/i })).toBeTruthy()
    })

    const titleInput = screen.getByRole('textbox', { name: /Title/i })
    expect((titleInput as HTMLInputElement).value).toBe('Original Title')

    // Edit the title input to trigger dirty state
    fireEvent.change(titleInput, { target: { value: 'Updated Autosaved Title' } })

    // Before debounce interval (500ms), no patch request has been sent yet
    expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)

    // Advance timers past debounce interval
    act(() => {
      vi.advanceTimersByTime(600)
    })

    // Autosave PATCH request was sent with draft=true&autosave=true
    await waitFor(() => {
      const patchReqs = requests.filter((r) => r.method === 'PATCH')
      expect(patchReqs.length).toBeGreaterThanOrEqual(1)
      expect(patchReqs[0]?.url).toContain('draft=true')
      expect(patchReqs[0]?.url).toContain('autosave=true')
    })

    // Saved indicator is displayed in sidebar
    await waitFor(() => {
      expect(screen.getByText('Saved just now')).toBeTruthy()
    })
  })

  it('handles multiple consecutive edits across intervals, sending PATCH for each edit (#232)', async () => {
    let currentDoc = {
      id: 1,
      title: 'Original Title',
      content: 'Original content',
      _status: 'draft',
      _isPublished: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const requests: { url: string; method: string; body?: string }[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithAutosave)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/1') && init?.method === 'PATCH') {
          const body = typeof init.body === 'string' ? init.body : undefined
          requests.push({ url, method: 'PATCH', body })
          const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {}
          currentDoc = {
            ...currentDoc,
            ...parsed,
            updatedAt: new Date().toISOString(),
          }
          return mockJsonResponse(currentDoc)
        }
        if (url.includes('/api/articles/1')) {
          return mockJsonResponse(currentDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/articles/1'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Title/i })).toBeTruthy()
    })

    const titleInput = screen.getByRole('textbox', { name: /Title/i })

    // Edit 1: change title to 'Edit One'
    fireEvent.change(titleInput, { target: { value: 'Edit One' } })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => {
      expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(1)
    })
    expect(requests[0]?.body).toContain('Edit One')

    await waitFor(() => {
      expect(screen.getByText('Saved just now')).toBeTruthy()
    })

    // Edit 2: change title to 'Edit Two'
    fireEvent.change(titleInput, { target: { value: 'Edit Two' } })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => {
      expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(2)
    })
    expect(requests[1]?.body).toContain('Edit Two')

    await waitFor(() => {
      expect(screen.getByText('Saved just now')).toBeTruthy()
    })

    // Edit 3: change title to 'Edit Three'
    fireEvent.change(titleInput, { target: { value: 'Edit Three' } })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => {
      expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(3)
    })
    expect(requests[2]?.body).toContain('Edit Three')
  })

  it('does not autosave when a required field is invalid', async () => {
    const existingDoc = {
      id: 1,
      title: 'Valid Title',
      content: 'Some text',
      _status: 'draft',
      _isPublished: false,
    }

    const requests: { url: string; method: string }[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithAutosave)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/1') && init?.method === 'PATCH') {
          requests.push({ url, method: 'PATCH' })
          return mockJsonResponse(existingDoc)
        }
        if (url.includes('/api/articles/1')) {
          return mockJsonResponse(existingDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/articles/1'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Title/i })).toBeTruthy()
    })

    const titleInput = screen.getByRole('textbox', { name: /Title/i })

    // Clear required title (invalid!)
    fireEvent.change(titleInput, { target: { value: '' } })

    // Advance timers past debounce interval
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // No PATCH request should have been made
    expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)
    expect(screen.queryByText('Saved just now')).toBeNull()
  })

  it('preserves form state and displays error indicator when autosave fails', async () => {
    const existingDoc = {
      id: 1,
      title: 'Original Title',
      content: 'Original content',
      _status: 'draft',
      _isPublished: false,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithAutosave)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/1') && init?.method === 'PATCH') {
          return Promise.reject(new Error('Failed to fetch: Network error'))
        }
        if (url.includes('/api/articles/1')) {
          return mockJsonResponse(existingDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/articles/1'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Title/i })).toBeTruthy()
    })

    const titleInput = screen.getByRole('textbox', { name: /Title/i })
    fireEvent.change(titleInput, { target: { value: 'My Unsaved Edits' } })

    // Advance timer to trigger autosave
    act(() => {
      vi.advanceTimersByTime(600)
    })

    // Error indicator is displayed
    await waitFor(() => {
      expect(screen.getByText("Couldn't save, retrying…")).toBeTruthy()
    })

    // Form retains the local user edits
    expect((titleInput as HTMLInputElement).value).toBe('My Unsaved Edits')
  })

  it('does not reset form, regenerate array ids, blur focus, or clear selected file on autosave success (#286)', async () => {
    const configWithArrayAndUpload: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
      collections: [
        {
          slug: 'articles',
          labels: { singular: 'Article', plural: 'Articles' },
          upload: true,
          versions: {
            drafts: true,
            autosave: { interval: 500 },
          },
          admin: { useAsTitle: 'title', defaultColumns: ['title'] },
          fields: [
            { name: 'title', label: 'Title', type: 'text', required: true },
            {
              name: 'tags',
              label: 'Tags',
              type: 'array',
              required: false,
              fields: [{ name: 'name', label: 'Tag Name', type: 'text', required: true }],
            },
          ],
        },
      ],
      globals: [],
    }

    const existingDoc = {
      id: 1,
      title: 'Original Title',
      tags: [{ id: 'row-1', name: 'Tech' }],
      _status: 'draft',
      _isPublished: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(configWithArrayAndUpload)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/1') && init?.method === 'PATCH') {
          return mockJsonResponse({
            ...existingDoc,
            tags: [{ id: 'row-1', name: 'Technology' }],
            updatedAt: '2026-01-01T00:00:01.000Z',
          })
        }
        if (url.includes('/api/articles/1')) {
          return mockJsonResponse(existingDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/articles/1'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Tech')).toBeTruthy()
    })

    const tagInput = screen.getByDisplayValue<HTMLInputElement>('Tech')
    tagInput.focus()
    expect(document.activeElement).toBe(tagInput)

    // Select a file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()
    const testFile = new File(['hello'], 'hello.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [testFile] } })

    // Verify file name is shown
    expect(screen.getByText('hello.png')).toBeTruthy()

    // Edit tag input
    fireEvent.change(tagInput, { target: { value: 'Technology' } })

    // Advance timer past autosave interval
    act(() => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => {
      expect(screen.getByText('Saved just now')).toBeTruthy()
    })

    // Focus is NOT lost
    expect(document.activeElement).toBe(tagInput)
    // Selected file is NOT cleared
    expect(screen.getByText('hello.png')).toBeTruthy()
  })

  it('does not reset form or blur focus when an edit is reverted back to saved value (#286)', async () => {
    const existingDoc = {
      id: 1,
      title: 'Original Title',
      content: 'Original content',
      _status: 'draft',
      _isPublished: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithAutosave)
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

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Title/i })).toBeTruthy()
    })

    const titleInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Title/i })
    titleInput.focus()
    expect(document.activeElement).toBe(titleInput)

    // Make an edit
    fireEvent.change(titleInput, { target: { value: 'Original Title Edited' } })

    // Revert the edit back to original value (isDirty becomes false)
    fireEvent.change(titleInput, { target: { value: 'Original Title' } })

    // Advance timers
    act(() => {
      vi.advanceTimersByTime(600)
    })

    // Focus remains on input
    expect(document.activeElement).toBe(titleInput)
  })
})

describe('Autosave in the global edit form', () => {
  const mockConfigWithGlobalAutosave: ClientConfig = {
    version: CLIENT_CONFIG_VERSION,
    collections: [],
    globals: [
      {
        slug: 'settings',
        label: 'Settings',
        versions: { drafts: true, autosave: { interval: 500 } },
        fields: [{ name: 'siteTitle', label: 'Site Title', type: 'text', required: true }],
      },
    ],
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('saves a draft instead of publishing the live global', async () => {
    const liveGlobal = {
      id: 1,
      siteTitle: 'Live Title',
      _status: 'published',
      _isPublished: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const saves: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithGlobalAutosave)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/globals/settings/versions')) {
          return mockJsonResponse({ docs: [], totalDocs: 0, page: 1, totalPages: 1, limit: 10 })
        }
        if (url.includes('/api/globals/settings') && init?.method === 'POST') {
          saves.push(url)
          return mockJsonResponse({ ...liveGlobal, siteTitle: 'Edited', _status: 'draft' })
        }
        if (url.includes('/api/globals/settings')) {
          return mockJsonResponse(liveGlobal)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/globals/settings'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Site Title/i })).toBeTruthy()
    })
    fireEvent.change(screen.getByRole('textbox', { name: /Site Title/i }), {
      target: { value: 'Edited' },
    })

    act(() => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => {
      expect(saves.length).toBeGreaterThanOrEqual(1)
    })
    expect(saves[0]).toContain('draft=true')
    expect(saves[0]).toContain('autosave=true')
  })

  it('does not blur focused input on autosave success (#286)', async () => {
    const liveGlobal = {
      id: 1,
      siteTitle: 'Live Title',
      _status: 'draft',
      _isPublished: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithGlobalAutosave)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/globals/settings/versions')) {
          return mockJsonResponse({ docs: [], totalDocs: 0, page: 1, totalPages: 1, limit: 10 })
        }
        if (url.includes('/api/globals/settings') && init?.method === 'POST') {
          return mockJsonResponse({
            ...liveGlobal,
            siteTitle: 'Edited Global',
            updatedAt: '2026-01-01T00:00:01.000Z',
          })
        }
        if (url.includes('/api/globals/settings')) {
          return mockJsonResponse(liveGlobal)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/globals/settings'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Site Title/i })).toBeTruthy()
    })

    const titleInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Site Title/i })
    titleInput.focus()
    expect(document.activeElement).toBe(titleInput)

    fireEvent.change(titleInput, { target: { value: 'Edited Global' } })

    act(() => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => {
      expect(screen.getByText('Saved just now')).toBeTruthy()
    })

    expect(document.activeElement).toBe(titleInput)
  })
})
