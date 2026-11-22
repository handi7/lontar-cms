import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  CLIENT_CONFIG_VERSION,
  type ClientConfig,
  type CollectionPermission,
} from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { AuthContext } from '../context/AuthContext'
import { PermissionsProvider } from '../context/PermissionsContext'
import { PortalContainerProvider } from '../context/PortalContainer'
import { ThemeContext } from '../context/ThemeContext'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'
import { CommandPalette } from './CommandPalette'
import { CommandPaletteProvider, isOutsideAdmin, isPaletteShortcut } from './CommandPaletteContext'
import { Sidebar } from './Sidebar'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return { ...actual, fetchPermissions: vi.fn() }
})

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    children,
    to,
    params: _params,
    activeOptions: _activeOptions,
    ...rest
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
    activeOptions?: unknown
  } & React.ComponentProps<'a'>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
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
    {
      slug: 'secrets',
      labels: { singular: 'Secret', plural: 'Secrets' },
      admin: { useAsTitle: 'title', defaultColumns: [] },
      fields: [],
    },
    {
      slug: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      admin: { useAsTitle: 'title', defaultColumns: [] },
      fields: [],
    },
  ],
  globals: [{ slug: 'settings', label: 'Site Settings', fields: [] }],
} as unknown as ClientConfig

function perm(overrides: Partial<CollectionPermission> = {}): CollectionPermission {
  return {
    read: true,
    create: true,
    update: true,
    delete: true,
    readVersions: true,
    fields: {},
    ...overrides,
  }
}

const user = { id: 'u1', email: 'admin@example.com', name: 'Admin User', role: 'admin' }

describe('Command palette (#215)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // cmdk scrolls the highlighted row into view, which happy-dom does not implement.
    Element.prototype.scrollIntoView = vi.fn()
    vi.mocked(client.fetchPermissions).mockResolvedValue({
      collections: { secrets: perm({ read: false }), pages: perm({ create: false }) },
      globals: {},
    })
  })

  afterEach(cleanup)

  function renderAdmin(withHostInput = false) {
    return render(
      <>
        {withHostInput && <input aria-label="Host search" />}
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
                        <input aria-label="Admin field" />
                        <CommandPalette />
                      </CommandPaletteProvider>
                    </PermissionsProvider>
                  </ThemeContext.Provider>
                </AuthContext.Provider>
              </AdminContext.Provider>
            </QueryClientProvider>
          </PortalContainerProvider>
        </div>
      </>,
    )
  }

  const palette = () => screen.queryByRole('dialog', { name: 'Command palette' })
  const press = (target: Element | Document, init: KeyboardEventInit) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
      )
    })

  async function openWithShortcut() {
    await screen.findByLabelText('Admin field')
    press(document.body, { key: 'k', ctrlKey: true })
    return screen.findByRole('dialog', { name: 'Command palette' })
  }

  it('opens on Ctrl+K and ⌘K, and closes on Escape', async () => {
    renderAdmin()
    expect(palette()).toBeNull()

    await openWithShortcut()
    press(document.body, { key: 'Escape' })
    await waitFor(() => expect(palette()).toBeNull())

    press(document.body, { key: 'k', metaKey: true })
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('toggles closed when the shortcut is pressed again', async () => {
    renderAdmin()
    await openWithShortcut()

    press(document.body, { key: 'k', ctrlKey: true })

    await waitFor(() => expect(palette()).toBeNull())
  })

  it('opens from the search button in the sidebar', async () => {
    renderAdmin()
    const aside = document.querySelector('aside') as HTMLElement

    fireEvent.click(within(aside).getByRole('button', { name: 'Open command palette' }))

    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('lists what the sidebar lists, and what the user may create', async () => {
    renderAdmin()
    const dialog = await openWithShortcut()

    expect(within(dialog).getByText('Go to Dashboard')).toBeTruthy()
    expect(within(dialog).getByText('Go to Posts')).toBeTruthy()
    expect(within(dialog).getByText('Go to Pages')).toBeTruthy()
    expect(within(dialog).getByText('Site Settings')).toBeTruthy()
    expect(within(dialog).getByText('Go to Users')).toBeTruthy()
    expect(within(dialog).getByText('New Post')).toBeTruthy()
    // No read access: not listed at all. No create access: can be opened but not created.
    expect(within(dialog).queryByText('Go to Secrets')).toBeNull()
    expect(within(dialog).queryByText('New Secret')).toBeNull()
    expect(within(dialog).queryByText('New Page')).toBeNull()
  })

  it('filters as you type and says so when nothing matches', async () => {
    renderAdmin()
    const dialog = await openWithShortcut()
    const input = within(dialog).getByRole('combobox')

    fireEvent.change(input, { target: { value: 'post' } })
    await waitFor(() => expect(within(dialog).queryByText('Go to Dashboard')).toBeNull())
    expect(within(dialog).getByText('Go to Posts')).toBeTruthy()
    expect(within(dialog).getByText('New Post')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'zzzz' } })
    expect(await within(dialog).findByText('No results found.')).toBeTruthy()
  })

  it('goes to the highlighted entry on Enter and closes', async () => {
    renderAdmin()
    const dialog = await openWithShortcut()
    const input = within(dialog).getByRole('combobox')

    fireEvent.change(input, { target: { value: 'new post' } })
    await within(dialog).findByText('New Post')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$collection/create',
      params: { collection: 'posts' },
    })
    await waitFor(() => expect(palette()).toBeNull())
  })

  it('moves the highlight with the arrow keys', async () => {
    renderAdmin()
    const dialog = await openWithShortcut()
    const input = within(dialog).getByRole('combobox')

    // Dashboard is first; one step down is Posts.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$collection',
      params: { collection: 'posts' },
    })
  })

  it('goes to a global with a click', async () => {
    renderAdmin()
    const dialog = await openWithShortcut()

    fireEvent.click(within(dialog).getByText('Site Settings'))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/globals/$slug',
      params: { slug: 'settings' },
    })
  })

  describe('host page guard', () => {
    it('leaves ⌘K alone when it is typed in the host page', async () => {
      renderAdmin(true)
      await screen.findByLabelText('Admin field')

      const hostEvent = new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => {
        screen.getByLabelText('Host search').dispatchEvent(hostEvent)
      })

      expect(palette()).toBeNull()
      expect(hostEvent.defaultPrevented).toBe(false)
    })

    it('opens when typed from a field inside the admin', async () => {
      renderAdmin(true)
      await screen.findByLabelText('Admin field')

      press(screen.getByLabelText('Admin field'), { key: 'k', ctrlKey: true })

      expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
    })

    it('treats body, the document, and the admin as ours, and the rest as the host’s', () => {
      const host = document.createElement('input')
      const inside = document.createElement('div')
      inside.className = 'lontar-admin'
      const field = document.createElement('input')
      inside.appendChild(field)
      document.body.append(host, inside)

      expect(isOutsideAdmin(host)).toBe(true)
      expect(isOutsideAdmin(field)).toBe(false)
      expect(isOutsideAdmin(document.body)).toBe(false)
      expect(isOutsideAdmin(document)).toBe(false)
      expect(isOutsideAdmin(null)).toBe(false)
      host.remove()
      inside.remove()
    })

    it('ignores other key combinations and events the host already handled', () => {
      const make = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)
      expect(isPaletteShortcut(make({ key: 'k', ctrlKey: true }))).toBe(true)
      expect(isPaletteShortcut(make({ key: 'k' }))).toBe(false)
      expect(isPaletteShortcut(make({ key: 'j', ctrlKey: true }))).toBe(false)
      expect(isPaletteShortcut(make({ key: 'k', ctrlKey: true, shiftKey: true }))).toBe(false)
      expect(isPaletteShortcut(make({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false)

      const handled = make({ key: 'k', ctrlKey: true, cancelable: true })
      handled.preventDefault()
      expect(isPaletteShortcut(handled)).toBe(false)
    })
  })
})
