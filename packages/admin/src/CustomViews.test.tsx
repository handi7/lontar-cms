import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryHistory } from '@tanstack/react-router'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { Admin } from './Admin'
import type { AdminComponents } from './context/ComponentRegistry'
import { SIDEBAR_STORAGE_KEY } from './layout/useSidebarCollapsed'
import type { CustomViewProps } from './views/custom-view-props'

const config: ClientConfig = {
  version: CLIENT_CONFIG_VERSION,
  admin: {
    views: [
      { key: 'seo-audit', label: 'SEO audit', component: 'seo-view' },
      { key: 'reports', label: 'Reports', component: 'reports-view' },
    ],
  },
  collections: [
    {
      slug: 'posts',
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title', defaultColumns: [] },
      fields: [{ name: 'title', label: 'Title', type: 'text', required: true }],
    },
  ],
  globals: [],
} as unknown as ClientConfig

const user = { id: 'u1', name: 'Editor', email: 'e@example.com', role: 'editor' }
const session = {
  id: 's1',
  userId: 'u1',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
}

function json(data: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function stubApi(views: Record<string, boolean> | undefined, permissionsDelayed = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('/_lontar/config')) return json(config)
      if (url.includes('/auth/get-session')) return json({ user, session })
      if (url.includes('/_lontar/permissions')) {
        if (permissionsDelayed) return new Promise(() => {})
        return json({ collections: {}, globals: {}, ...(views ? { views } : {}) })
      }
      return json({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
    }),
  )
}

const seen: CustomViewProps[] = []
const components: AdminComponents = {
  'seo-view': (props: CustomViewProps) => {
    seen.push(props)
    return <div data-testid="seo-body">SEO body</div>
  },
  'reports-view': () => <div data-testid="reports-body">Reports body</div>,
}

function renderAt(path: string, extra: AdminComponents = components) {
  const history = createMemoryHistory({ initialEntries: [path] })
  return render(<Admin apiBase="/api" basePath="/admin" history={history} components={extra} />)
}

const sidebar = () => within(document.querySelector('aside') as HTMLElement)

describe('custom views (#467)', () => {
  beforeEach(() => {
    seen.length = 0
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists only the views the user may see in the sidebar', async () => {
    stubApi({ 'seo-audit': true, reports: false })
    renderAt('/admin')

    await waitFor(() => expect(sidebar().getByRole('link', { name: 'SEO audit' })).toBeTruthy())
    expect(sidebar().getByText('Views')).toBeTruthy()
    expect(sidebar().queryByRole('link', { name: 'Reports' })).toBeNull()
    expect(sidebar().getByRole('link', { name: 'SEO audit' }).getAttribute('href')).toBe(
      '/admin/views/seo-audit',
    )
  })

  it('has no Views section when the user may see none', async () => {
    stubApi({ 'seo-audit': false, reports: false })
    renderAt('/admin')

    await waitFor(() => expect(sidebar().getByRole('link', { name: 'Posts' })).toBeTruthy())
    expect(sidebar().queryByText('Views')).toBeNull()
  })

  it('keeps every view hidden when the permissions omit views', async () => {
    stubApi(undefined)
    renderAt('/admin')

    await waitFor(() => expect(sidebar().getByRole('link', { name: 'Posts' })).toBeTruthy())
    expect(sidebar().queryByText('Views')).toBeNull()
  })

  it('follows the collapsed sidebar: initials, with the label kept for screen readers', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '1')
    stubApi({ 'seo-audit': true, reports: true })
    renderAt('/admin')

    const link = await waitFor(() => sidebar().getByRole('link', { name: 'SEO audit' }))
    expect(link.textContent).toContain('S')
    expect(sidebar().queryByText('Views')).toBeNull()
  })

  it('renders the registered component under the label, with its props', async () => {
    stubApi({ 'seo-audit': true, reports: true })
    renderAt('/admin/views/seo-audit')

    await waitFor(() => expect(screen.getByTestId('seo-body')).toBeTruthy())
    expect(screen.getByRole('heading', { level: 1, name: 'SEO audit' })).toBeTruthy()
    expect(seen.at(-1)).toEqual({ viewKey: 'seo-audit', label: 'SEO audit' })
  })

  it('shows the not-found page for a view the user cannot see, without rendering it', async () => {
    stubApi({ 'seo-audit': true, reports: false })
    renderAt('/admin/views/reports')

    await waitFor(() => expect(screen.getByText('Page Not Found')).toBeTruthy())
    expect(screen.queryByTestId('reports-body')).toBeNull()
  })

  it('shows the not-found page for a key the config does not list', async () => {
    stubApi({ 'seo-audit': true, reports: true })
    renderAt('/admin/views/nope')

    await waitFor(() => expect(screen.getByText('Page Not Found')).toBeTruthy())
  })

  it('renders nothing of the view until the permissions have loaded', async () => {
    stubApi(undefined, true)
    renderAt('/admin/views/seo-audit')

    // The layout holds the whole admin back while the permissions load, so no view can flash.
    await waitFor(() => expect(screen.getByText(/loading permissions/i)).toBeTruthy())
    expect(screen.queryByTestId('seo-body')).toBeNull()
    expect(screen.queryByText('SEO audit')).toBeNull()
  })

  it('shows a placeholder for an unregistered component and keeps the page working', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubApi({ 'seo-audit': true, reports: true })
    renderAt('/admin/views/seo-audit', {})

    await waitFor(() =>
      expect(screen.getByTestId('custom-component-missing-seo-view')).toBeTruthy(),
    )
    expect(sidebar().getByRole('link', { name: 'Posts' })).toBeTruthy()
    const ours = warn.mock.calls.filter((call) => String(call[0]).startsWith('[lontar]'))
    expect(ours).toHaveLength(1)
  })

  it('contains a view that throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubApi({ 'seo-audit': true, reports: true })
    renderAt('/admin/views/seo-audit', {
      'seo-view': (): never => {
        throw new Error('boom')
      },
    })

    await waitFor(() => expect(screen.getByTestId('custom-component-error-seo-view')).toBeTruthy())
    expect(sidebar().getByRole('link', { name: 'Posts' })).toBeTruthy()
  })

  it('offers visible views in the command palette, and not hidden ones', async () => {
    stubApi({ 'seo-audit': true, reports: false })
    renderAt('/admin')
    await waitFor(() => expect(sidebar().getByRole('link', { name: 'SEO audit' })).toBeTruthy())

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('SEO audit')).toBeTruthy()
    expect(within(dialog).queryByText('Reports')).toBeNull()
  })
})
