import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'
import { AdminContext } from '../context/AdminContext'
import { AuthContext } from '../context/AuthContext'
import { ComponentRegistryProvider, type AdminComponents } from '../context/ComponentRegistry'
import { PermissionsProvider } from '../context/PermissionsContext'
import type { DashboardWidgetProps } from './dashboard-widget-props'
import { DashboardView } from './DashboardView'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return { ...actual, fetchPermissions: vi.fn() }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
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

const user = { id: 'u1', email: 'a@example.com', name: 'A', role: 'admin' }

function configWith(admin?: ClientConfig['admin']): ClientConfig {
  return {
    version: CLIENT_CONFIG_VERSION,
    ...(admin ? { admin } : {}),
    collections: [
      {
        slug: 'posts',
        labels: { singular: 'Post', plural: 'Posts' },
        admin: { useAsTitle: 'title', defaultColumns: [] },
        fields: [],
      },
    ],
    globals: [],
  } as unknown as ClientConfig
}

function renderDashboard(config: ClientConfig, components: AdminComponents = {}) {
  return render(
    <div className="lontar-admin">
      <QueryClientProvider client={new QueryClient()}>
        <AdminContext.Provider value={{ config, apiBase: '/api', basePath: '/admin' }}>
          <AuthContext.Provider
            value={{ user, session: null, isLoading: false, signIn: vi.fn(), signOut: vi.fn() }}
          >
            <PermissionsProvider apiBase="/api" user={{ id: 'u1' }}>
              <ComponentRegistryProvider components={components}>
                <DashboardView />
              </ComponentRegistryProvider>
            </PermissionsProvider>
          </AuthContext.Provider>
        </AdminContext.Provider>
      </QueryClientProvider>
    </div>,
  )
}

function Tile({ label }: { label: string }) {
  return <div>{label}</div>
}

describe('dashboard widgets (#466)', () => {
  beforeEach(() => {
    vi.mocked(client.fetchPermissions).mockResolvedValue({ collections: {}, globals: {} })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders no widgets section when none are configured', () => {
    renderDashboard(configWith())

    expect(screen.queryByTestId(/^dashboard-widget-/)).toBeNull()
    expect(screen.getByText('Posts')).toBeTruthy()
  })

  it('renders the registered components in config order, above the collection cards', () => {
    const components: AdminComponents = {
      first: () => <Tile label="First tile" />,
      second: () => <Tile label="Second tile" />,
    }
    renderDashboard(
      configWith({
        dashboard: {
          widgets: [
            { component: 'second', width: 'full' },
            { component: 'first', width: 'full' },
          ],
        },
      }),
      components,
    )

    const widgets = screen.getAllByTestId(/^dashboard-widget-/)
    expect(widgets.map((w) => w.textContent)).toEqual(['Second tile', 'First tile'])

    const posts = screen.getByText('Posts')
    expect(widgets[0]?.compareDocumentPosition(posts)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('gives a widget its width, and a column span that matches it', () => {
    const seen: DashboardWidgetProps[] = []
    const Probe = (props: DashboardWidgetProps) => {
      seen.push(props)
      return <span>probe</span>
    }
    renderDashboard(
      configWith({
        dashboard: {
          widgets: [
            { component: 'probe', width: 'half' },
            { component: 'probe', width: 'full' },
          ],
        },
      }),
      { probe: Probe },
    )

    const [half, full] = screen.getAllByTestId('dashboard-widget-probe')
    expect(half?.getAttribute('data-width')).toBe('half')
    expect(half?.className).toContain('col-span-1')
    expect(full?.getAttribute('data-width')).toBe('full')
    expect(full?.className).toContain('col-span-2')
    expect(new Set(seen.map((p) => p.width))).toEqual(new Set(['half', 'full']))
  })

  it('renders the same component twice', () => {
    renderDashboard(
      configWith({
        dashboard: {
          widgets: [
            { component: 'tile', width: 'half' },
            { component: 'tile', width: 'half' },
          ],
        },
      }),
      { tile: () => <Tile label="Tile" /> },
    )

    expect(screen.getAllByText('Tile')).toHaveLength(2)
  })

  it('shows a placeholder and warns once for an unregistered key, keeping the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderDashboard(
      configWith({
        dashboard: {
          widgets: [
            { component: 'missing', width: 'full' },
            { component: 'ok', width: 'full' },
          ],
        },
      }),
      { ok: () => <Tile label="Still here" /> },
    )

    expect(screen.getByTestId('custom-component-missing-missing')).toBeTruthy()
    expect(screen.getByText('Still here')).toBeTruthy()
    expect(screen.getByText('Posts')).toBeTruthy()
    const ours = warn.mock.calls.filter((call) => String(call[0]).startsWith('[lontar]'))
    expect(ours).toHaveLength(1)
  })

  it('contains a widget that throws: the other widgets and the collections still render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = (): never => {
      throw new Error('boom')
    }
    renderDashboard(
      configWith({
        dashboard: {
          widgets: [
            { component: 'broken', width: 'half' },
            { component: 'ok', width: 'half' },
          ],
        },
      }),
      { broken: Broken, ok: () => <Tile label="Fine" /> },
    )

    expect(screen.getByTestId('custom-component-error-broken')).toBeTruthy()
    expect(screen.getByText('Fine')).toBeTruthy()
    expect(screen.getByText('Posts')).toBeTruthy()
  })
})
