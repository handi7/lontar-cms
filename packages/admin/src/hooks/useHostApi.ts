import { useCallback } from 'react'
import type { ClientConfig } from '@lontar/core/client'
import { useAdmin } from '../context/AdminContext'

/** The `ClientConfig` the admin is running on. Plain JSON: no functions, no secrets. */
export function useAdminConfig(): ClientConfig {
  return useAdmin().config
}

/**
 * `fetch` bound to the REST API: a path such as `/stats/pending` is resolved against `apiBase` and
 * the request carries the session cookie. Use it to call custom endpoints from a component.
 */
export function useLontarFetch(): (path: string, init?: RequestInit) => Promise<Response> {
  const { apiBase } = useAdmin()
  return useCallback(
    (path, init) => {
      const base = apiBase.replace(/\/+$/, '')
      const suffix = path.startsWith('/') ? path : `/${path}`
      return fetch(`${base}${suffix}`, { credentials: 'include', ...init })
    },
    [apiBase],
  )
}
