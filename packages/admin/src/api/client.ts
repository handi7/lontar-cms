import type { ClientConfig } from '@lontar/core/client'

export interface AdminUser {
  id: string
  email: string
  name: string
  image?: string | null
  role?: string
  [key: string]: unknown
}

export interface AdminSession {
  id: string
  userId: string
  expiresAt: string | Date
  [key: string]: unknown
}

export interface AuthSessionResponse {
  user: AdminUser | null
  session: AdminSession | null
}

export interface PaginatedDocs<T = Record<string, unknown>> {
  docs: T[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}: ${res.statusText}`
    try {
      const data = (await res.json()) as { error?: string; message?: string }
      if (data?.error) {
        errorMsg = data.error
      } else if (data?.message) {
        errorMsg = data.message
      }
    } catch {
      // response was not JSON
    }
    throw new Error(errorMsg)
  }
  return (await res.json()) as T
}

export async function fetchClientConfig(apiBase: string): Promise<ClientConfig> {
  const url = `${apiBase.replace(/\/+$/, '')}/_lontar/config`
  const res = await fetch(url, { credentials: 'include' })
  return handleResponse<ClientConfig>(res)
}

export async function fetchSession(apiBase: string): Promise<AuthSessionResponse | null> {
  const base = apiBase.replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/auth/get-session`, {
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { user?: AdminUser; session?: AdminSession } | null
    if (!data || !data.user) {
      return null
    }
    return {
      user: data.user,
      session: data.session ?? null,
    }
  } catch {
    return null
  }
}

export async function signIn(
  apiBase: string,
  credentials: { email: string; password: string },
): Promise<{ user: AdminUser; session: AdminSession }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(credentials),
  })
  return handleResponse<{ user: AdminUser; session: AdminSession }>(res)
}

export async function signOut(apiBase: string): Promise<void> {
  const base = apiBase.replace(/\/+$/, '')
  await fetch(`${base}/auth/sign-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
}

export async function fetchCollectionDocs(
  apiBase: string,
  slug: string,
  options: { page?: number; limit?: number; sort?: string } = {},
): Promise<PaginatedDocs> {
  const base = apiBase.replace(/\/+$/, '')
  const params = new URLSearchParams()
  if (options.page) params.set('page', String(options.page))
  if (options.limit) params.set('limit', String(options.limit))
  if (options.sort) params.set('sort', options.sort)

  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${base}/${slug}${query}`, { credentials: 'include' })
  return handleResponse<PaginatedDocs>(res)
}

export async function fetchDoc(
  apiBase: string,
  slug: string,
  id: number | string,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/${slug}/${id}`, { credentials: 'include' })
  return handleResponse<Record<string, unknown>>(res)
}

export async function createDoc(
  apiBase: string,
  slug: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function updateDoc(
  apiBase: string,
  slug: string,
  id: number | string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/${slug}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function deleteDoc(
  apiBase: string,
  slug: string,
  id: number | string,
): Promise<{ success: boolean }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/${slug}/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return handleResponse<{ success: boolean }>(res)
}
