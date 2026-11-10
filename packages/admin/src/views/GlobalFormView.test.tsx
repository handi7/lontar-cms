import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory } from '@tanstack/react-router'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { openDropdownMenu } from '../test/radix'
import { Admin } from '../Admin'

const mockConfigWithDrafts: ClientConfig = {
  version: CLIENT_CONFIG_VERSION,
  collections: [],
  globals: [
    {
      slug: 'settings',
      label: 'Site Settings',
      versions: { drafts: true },
      fields: [
        { name: 'siteTitle', label: 'Site Title', type: 'text', required: true },
        { name: 'description', label: 'Description', type: 'textarea', required: false },
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

function mockJsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function parseJsonBody(body: unknown): Record<string, unknown> | undefined {
  if (typeof body === 'string') {
    return JSON.parse(body) as Record<string, unknown>
  }
  return undefined
}

describe('Global form draft and publish (#234)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(cleanup)

  it('publishing a global sends edited values and retains them in the form', async () => {
    let globalDoc: Record<string, unknown> = {
      siteTitle: 'Initial Title',
      description: 'Initial description',
      _status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const requests: { url: string; method: string; body?: unknown }[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithDrafts)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/globals/settings/versions')) {
          return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
        }
        if (url.includes('/api/globals/settings') && init?.method === 'POST') {
          const body = parseJsonBody(init.body)
          requests.push({ url, method: 'POST', body })
          const isDraft = url.includes('draft=true')
          globalDoc = {
            ...globalDoc,
            ...body,
            _status: isDraft ? 'draft' : 'published',
            updatedAt: new Date().toISOString(),
          }
          return mockJsonResponse(globalDoc)
        }
        if (url.includes('/api/globals/settings')) {
          return mockJsonResponse(globalDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/globals/settings'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    // Wait for form to load
    const titleInput = await screen.findByLabelText<HTMLInputElement>(/site title/i)
    await waitFor(() => {
      expect(titleInput.value).toBe('Initial Title')
    })

    // Edit the title
    fireEvent.change(titleInput, { target: { value: 'Published Title' } })
    expect(titleInput.value).toBe('Published Title')

    // Click Publish button
    const publishBtn = screen.getByRole('button', { name: 'Publish' })
    expect(publishBtn).toBeTruthy()
    fireEvent.click(publishBtn)

    // Wait for success alert
    await waitFor(() => {
      expect(screen.getByText('Published successfully.')).toBeTruthy()
    })

    // Ensure the form retains the edited title, not resetting back to initial
    expect(titleInput.value).toBe('Published Title')

    // Ensure POST was sent with the edited value and NOT to /publish with empty body
    const postReq = requests[requests.length - 1]
    expect(postReq).toBeDefined()
    expect(postReq?.url).toBe('/api/globals/settings')
    expect(postReq?.url).not.toContain('/publish')
    expect(postReq?.body).toMatchObject({
      siteTitle: 'Published Title',
      description: 'Initial description',
    })
  })

  it('saving draft sends edited values with draft=true', async () => {
    let globalDoc: Record<string, unknown> = {
      siteTitle: 'Initial Title',
      description: 'Initial description',
      _status: 'published',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const requests: { url: string; method: string; body?: unknown }[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithDrafts)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/globals/settings/versions')) {
          return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
        }
        if (url.includes('/api/globals/settings') && init?.method === 'POST') {
          const body = parseJsonBody(init.body)
          requests.push({ url, method: 'POST', body })
          const isDraft = url.includes('draft=true')
          globalDoc = {
            ...globalDoc,
            ...body,
            _status: isDraft ? 'draft' : 'published',
            updatedAt: new Date().toISOString(),
          }
          return mockJsonResponse(globalDoc)
        }
        if (url.includes('/api/globals/settings')) {
          return mockJsonResponse(globalDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/globals/settings'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    const titleInput = await screen.findByLabelText<HTMLInputElement>(/site title/i)
    await waitFor(() => {
      expect(titleInput.value).toBe('Initial Title')
    })

    fireEvent.change(titleInput, { target: { value: 'New Draft Title' } })
    expect(titleInput.value).toBe('New Draft Title')

    const optionsBtn = screen.getByRole('button', { name: 'Publishing options' })
    openDropdownMenu(optionsBtn)

    const saveDraftItem = screen.getByText('Save draft')
    fireEvent.click(saveDraftItem)

    await waitFor(() => {
      expect(screen.getByText('Draft saved successfully.')).toBeTruthy()
    })

    expect(titleInput.value).toBe('New Draft Title')

    const postReq = requests[requests.length - 1]
    expect(postReq?.url).toContain('/api/globals/settings?draft=true')
    expect(postReq?.body).toMatchObject({
      siteTitle: 'New Draft Title',
    })
  })

  it('blocks publish when validation fails on required fields', async () => {
    const globalDoc: Record<string, unknown> = {
      siteTitle: 'Initial Title',
      description: 'Initial description',
      _status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const requests: { url: string; method: string }[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfigWithDrafts)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/globals/settings/versions')) {
          return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
        }
        if (url.includes('/api/globals/settings') && init?.method === 'POST') {
          requests.push({ url, method: 'POST' })
          return mockJsonResponse(globalDoc)
        }
        if (url.includes('/api/globals/settings')) {
          return mockJsonResponse(globalDoc)
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`))
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/admin/globals/settings'] })
    render(<Admin apiBase="/api" basePath="/admin" history={history} />)

    const titleInput = await screen.findByLabelText<HTMLInputElement>(/site title/i)
    await waitFor(() => {
      expect(titleInput.value).toBe('Initial Title')
    })

    // Clear required field
    fireEvent.change(titleInput, { target: { value: '' } })
    expect(titleInput.value).toBe('')

    // Attempt to publish
    const publishBtn = screen.getByRole('button', { name: 'Publish' })
    fireEvent.click(publishBtn)

    // Validation error should show up and no request should be sent
    await waitFor(() => {
      expect(requests.length).toBe(0)
    })
  })
})
