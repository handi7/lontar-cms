import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory } from '@tanstack/react-router'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { openDropdownMenu } from '../test/radix'
import { Admin } from '../Admin'

const mockConfig: ClientConfig = {
  version: CLIENT_CONFIG_VERSION,
  collections: [
    {
      slug: 'articles',
      labels: { singular: 'Article', plural: 'Articles' },
      versions: { drafts: true },
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

function parseJsonBody(body: unknown): Record<string, unknown> | undefined {
  if (typeof body === 'string') {
    return JSON.parse(body) as Record<string, unknown>
  }
  return undefined
}

function handleMockPatch(
  url: string,
  init: RequestInit | undefined,
  existingDoc: Record<string, unknown>,
  requests: { url: string; method: string; body?: unknown }[],
) {
  const body = parseJsonBody(init?.body)
  requests.push({ url, method: 'PATCH', body })
  const isDraft = url.includes('draft=true')
  return mockJsonResponse({
    ...existingDoc,
    ...body,
    _status: isDraft ? 'draft' : 'published',
    _isPublished: true,
  })
}

describe('Draft and publish controls (#201)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(cleanup)

  it('renders status column in list view and passes draft=true query param', async () => {
    let capturedUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles')) {
          capturedUrl = url
          return mockJsonResponse({
            docs: [
              { id: 1, title: 'Draft Post', _status: 'draft', _isPublished: false },
              { id: 2, title: 'Published Post', _status: 'published', _isPublished: true },
              { id: 3, title: 'Changed Post', _status: 'draft', _isPublished: true },
            ],
            totalDocs: 3,
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

    // Wait for documents to load into the table
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /status/i })).toBeTruthy()
    })

    // fetchCollectionDocs was called with draft=true
    expect(capturedUrl).toContain('draft=true')

    // Renders all three badges in table rows
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('Published')).toBeTruthy()
    expect(screen.getByText('Changed')).toBeTruthy()

    // Status filter select is visible
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeTruthy()
  })

  it('allows saving as draft, publishing, and unpublishing on the edit form', async () => {
    const existingDoc = {
      id: 1,
      title: 'Current Article',
      content: 'Hello world',
      _status: 'draft',
      _isPublished: true, // Changed state
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }

    const requests: { url: string; method: string; body?: unknown }[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/_lontar/config')) {
          return mockJsonResponse(mockConfig)
        }
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({ user: mockAuthUser, session: mockAuthSession })
        }
        if (url.includes('/api/articles/1/unpublish') && init?.method === 'POST') {
          requests.push({ url, method: 'POST' })
          return mockJsonResponse({ ...existingDoc, _status: 'draft', _isPublished: false })
        }
        if (url.includes('/api/articles/1') && init?.method === 'PATCH') {
          return handleMockPatch(url, init, existingDoc, requests)
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
      expect(screen.getByRole('complementary', { name: 'Document sidebar' })).toBeTruthy()
    })

    // Shows Changed status badge in document sidebar
    const sidebar = screen.getByRole('complementary', { name: 'Document sidebar' })
    expect(sidebar.querySelector('[data-status="changed"]')).toBeTruthy()

    // Primary button says Publish
    const publishBtn = screen.getByRole('button', { name: 'Publish' })
    expect(publishBtn).toBeTruthy()

    // 1. Test "Save draft"
    const optionsBtn = screen.getByRole('button', { name: 'Publishing options' })
    expect(optionsBtn).toBeTruthy()
    openDropdownMenu(optionsBtn)

    const saveDraftItem = screen.getByText('Save draft')
    fireEvent.click(saveDraftItem)

    await waitFor(() => {
      expect(screen.getByText('Draft saved!')).toBeTruthy()
    })

    const lastDraftReq = requests[requests.length - 1]
    expect(lastDraftReq?.url).toContain('/api/articles/1?draft=true')
    expect(lastDraftReq?.method).toBe('PATCH')

    // 2. Test "Publish"
    fireEvent.click(publishBtn)

    await waitFor(() => {
      expect(screen.getByText('Published successfully!')).toBeTruthy()
    })

    const lastPublishReq = requests[requests.length - 1]
    expect(lastPublishReq?.url).toBe('/api/articles/1')
    expect(lastPublishReq?.method).toBe('PATCH')

    // 3. Test "Unpublish"
    openDropdownMenu(optionsBtn)
    const unpublishItem = screen.getByText('Unpublish')
    fireEvent.click(unpublishItem)

    await waitFor(() => {
      expect(screen.getByText('Unpublished successfully!')).toBeTruthy()
    })

    const lastUnpublishReq = requests[requests.length - 1]
    expect(lastUnpublishReq?.url).toBe('/api/articles/1/unpublish')
    expect(lastUnpublishReq?.method).toBe('POST')
  })
})
