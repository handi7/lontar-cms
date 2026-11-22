import { useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { RouterHistory } from '@tanstack/history'
import { RouterProvider } from '@tanstack/react-router'
import { AdminContext } from './context/AdminContext'
import { AuthProvider } from './context/AuthContext'
import { ComponentRegistryProvider, type AdminComponents } from './context/ComponentRegistry'
import { PermissionsProvider } from './context/PermissionsContext'
import { FullPageError, FullPageLoading } from './layout/FullPageState'
import { PortalContainerProvider } from './context/PortalContainer'
import { ThemeContext, useThemePreference } from './context/ThemeContext'
import { fetchClientConfig } from './api/client'
import { createAdminBrowserHistory } from './router/history'
import { createAdminRouter } from './router/routes'

export interface AdminProps {
  /** Base URL the REST API is mounted at. Defaults to '/api'. */
  apiBase?: string
  /** Base path the admin itself is mounted at, used for routing. Defaults to '/admin'. */
  basePath?: string
  /** Optional history override, e.g. createMemoryHistory() for tests. */
  history?: RouterHistory
  /**
   * Components the config refers to by key, e.g. `admin.component: 'rating-stars'` on a field.
   * Server code and client code meet only through these string keys (ADR 0029).
   */
  components?: AdminComponents
}

interface AdminInnerProps {
  apiBase: string
  basePath: string
  history?: RouterHistory
  components?: AdminComponents
}

function AdminInner({ apiBase, basePath, history, components }: AdminInnerProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const { theme, setTheme, dataTheme } = useThemePreference(mounted)

  const {
    data: config,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['_lontar_config', apiBase],
    queryFn: () => fetchClientConfig(apiBase),
    enabled: mounted,
  })

  const router = useMemo(() => {
    if (!mounted) return null
    return createAdminRouter({ basePath, history: history ?? createAdminBrowserHistory() })
  }, [mounted, basePath, history])

  if (!mounted || isLoading || !router) {
    return (
      <div className="lontar-admin" data-theme={dataTheme}>
        <FullPageLoading>Loading Lontar CMS configuration...</FullPageLoading>
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="lontar-admin" data-theme={dataTheme}>
        <FullPageError title="Failed to load admin configuration">
          {error ? error.message : 'No configuration received from API'}
        </FullPageError>
      </div>
    )
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <AdminContext.Provider value={{ config, apiBase, basePath }}>
        <AuthProvider apiBase={apiBase}>
          <PermissionsProvider apiBase={apiBase}>
            <div className="lontar-admin" data-theme={dataTheme}>
              <ComponentRegistryProvider components={components}>
                <PortalContainerProvider>
                  <RouterProvider router={router} />
                </PortalContainerProvider>
              </ComponentRegistryProvider>
            </div>
          </PermissionsProvider>
        </AuthProvider>
      </AdminContext.Provider>
    </ThemeContext.Provider>
  )
}

export function Admin({ apiBase = '/api', basePath = '/admin', history, components }: AdminProps) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 5000,
          },
        },
      }),
    [],
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AdminInner apiBase={apiBase} basePath={basePath} history={history} components={components} />
    </QueryClientProvider>
  )
}
