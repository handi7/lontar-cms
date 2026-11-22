import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { AuthContext } from '../context/AuthContext'
import { PermissionsProvider } from '../context/PermissionsContext'
import { PortalContainerProvider } from '../context/PortalContainer'
import { ThemeContext } from '../context/ThemeContext'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'
import { CommandPaletteProvider } from './CommandPaletteContext'
import { Sidebar } from './Sidebar'
import { SIDEBAR_STORAGE_KEY } from './useSidebarCollapsed'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return { ...actual, fetchPermissions: vi.fn() }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    activeOptions: _activeOptions,
    ...rest
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
    activeOptions?: unknown
  } & React.ComponentProps<'a'>) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to,
    )
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

const config: ClientConfig = {
  version: CLIENT_CONFIG_VERSION,
  collections: [
    {
      slug: 'posts',
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title', defaultColumns: [] },
      fields: [],
    },
  ],
  globals: [{ slug: 'settings', label: 'Site Settings', fields: [] }],
} as unknown as ClientConfig

const user = { id: 'u1', email: 'admin@example.com', name: 'Admin User', role: 'admin' }

describe('Sidebar (#213)', () => {
  beforeEach(() => {
    window.localStorage.removeItem(SIDEBAR_STORAGE_KEY)
    vi.mocked(client.fetchPermissions).mockResolvedValue({ collections: {}, globals: {} })
  })

  afterEach(() => {
    cleanup()
    window.localStorage.removeItem(SIDEBAR_STORAGE_KEY)
    vi.restoreAllMocks()
  })

  function renderSidebar() {
    return render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <QueryClientProvider client={new QueryClient()}>
            <AdminContext.Provider value={{ config, apiBase: '/api', basePath: '/admin' }}>
              <AuthContext.Provider
                value={{
                  user,
                  session: null,
                  isLoading: false,
                  signIn: vi.fn(),
                  signOut: vi.fn(),
                }}
              >
                <ThemeContext.Provider value={{ theme: 'system', setTheme: vi.fn() }}>
                  <PermissionsProvider apiBase="/api" user={{ id: 'u1' }}>
                    <CommandPaletteProvider>
                      <Sidebar />
                    </CommandPaletteProvider>
                  </PermissionsProvider>
                </ThemeContext.Provider>
              </AuthContext.Provider>
            </AdminContext.Provider>
          </QueryClientProvider>
        </PortalContainerProvider>
      </div>,
    )
  }

  const aside = () => within(document.querySelector('aside') as HTMLElement)

  it('starts expanded, with each label in view', () => {
    renderSidebar()

    expect(aside().getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy()
    expect(aside().getByText('Posts').className).not.toContain('sr-only')
    expect(aside().getByText('Collections')).toBeTruthy()
  })

  it('collapses to initials that keep their accessible names, and remembers it', () => {
    renderSidebar()

    fireEvent.click(aside().getByRole('button', { name: 'Collapse sidebar' }))

    const toggle = aside().getByRole('button', { name: 'Expand sidebar' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(aside().getByRole('link', { name: 'Posts' }).textContent).toContain('P')
    expect(aside().getByRole('link', { name: 'Site Settings' }).textContent).toContain('S')
    expect(aside().getByText('Posts').className).toContain('sr-only')
    expect(aside().queryByText('Collections')).toBeNull()
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('1')

    fireEvent.click(toggle)
    expect(aside().getByText('Collections')).toBeTruthy()
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull()
  })

  it('starts collapsed when that was the stored choice', () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '1')
    renderSidebar()

    expect(aside().getByRole('button', { name: 'Expand sidebar' })).toBeTruthy()
  })

  it('shows the full label in a tooltip on a collapsed item', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '1')
    renderSidebar()

    fireEvent.focus(aside().getByRole('link', { name: 'Posts' }))

    expect((await screen.findByRole('tooltip')).textContent).toContain('Posts')
  })

  it('is expanded, and still toggles, when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    renderSidebar()

    expect(aside().getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy()
    fireEvent.click(aside().getByRole('button', { name: 'Collapse sidebar' }))
    expect(aside().getByRole('button', { name: 'Expand sidebar' })).toBeTruthy()
  })

  it('keeps sign out and the account link reachable when collapsed', () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '1')
    renderSidebar()

    expect(aside().getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(aside().getByRole('link', { name: 'Account settings' })).toBeTruthy()
    expect(aside().getByRole('group', { name: 'Theme' })).toBeTruthy()
  })

  it('opens the navigation as a drawer from the menu button and closes it after a link', async () => {
    renderSidebar()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    // The drawer is always expanded, whatever the rail's state.
    expect(within(drawer).getByText('Collections')).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('link', { name: 'Posts' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes the drawer with its close button', async () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
