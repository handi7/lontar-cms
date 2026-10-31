import { useMemo } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { RouterProvider, type RouterHistory } from '@tanstack/react-router'
import { AdminContext } from './context/AdminContext'
import { fetchClientConfig } from './api/client'
import { createAdminRouter } from './router/routes'

export interface AdminProps {
  /** Base URL the REST API is mounted at. Defaults to '/api'. */
  apiBase?: string
  /** Base path the admin itself is mounted at, used for routing. Defaults to '/admin'. */
  basePath?: string
  /** Optional history override, e.g. createMemoryHistory() for tests. */
  history?: RouterHistory
}

function AdminInner({
  apiBase,
  basePath,
  history,
}: {
  apiBase: string
  basePath: string
  history?: RouterHistory
}) {
  const {
    data: config,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['_lontar_config', apiBase],
    queryFn: () => fetchClientConfig(apiBase),
  })

  const router = useMemo(() => {
    return createAdminRouter({ basePath, history })
  }, [basePath, history])

  if (isLoading) {
    return (
      <div className="lontar-admin">
        <div className="lontar-init-loading">
          <div className="lontar-spinner" />
          <p>Loading Lontar CMS configuration...</p>
        </div>
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="lontar-admin">
        <div className="lontar-init-error">
          <h2>Failed to load admin configuration</h2>
          <p>{error ? error.message : 'No configuration received from API'}</p>
        </div>
      </div>
    )
  }

  return (
    <AdminContext.Provider value={{ config, apiBase, basePath }}>
      <div className="lontar-admin">
        <RouterProvider router={router} />
      </div>
    </AdminContext.Provider>
  )
}

export function Admin({ apiBase = '/api', basePath = '/admin', history }: AdminProps) {
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
      <AdminInner apiBase={apiBase} basePath={basePath} history={history} />
    </QueryClientProvider>
  )
}
