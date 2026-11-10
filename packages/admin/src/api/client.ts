import type {
  ClientConfig,
  ClientPaginatedVersions,
  ClientVersion,
  Where,
} from '@lontar/core/client'

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

export interface ApiIssue {
  code?: string
  path?: (string | number)[]
  message: string
}

export class ApiClientError extends Error {
  readonly status: number
  readonly issues?: ApiIssue[]

  constructor(message: string, status: number, issues?: ApiIssue[]) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.issues = issues
  }
}

export { queryKeys } from './query-keys'

export function formatApiErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.issues && err.issues.length > 0) {
      const issueDetails = err.issues
        .map((i) => i.message)
        .filter(Boolean)
        .join(', ')
      if (issueDetails) {
        return `${err.message}: ${issueDetails}`
      }
    }
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

export type UnauthorizedHandler = () => void
let onUnauthorizedHandler: UnauthorizedHandler | null = null

export function setOnUnauthorized(handler: UnauthorizedHandler | null): void {
  onUnauthorizedHandler = handler
}

async function parseErrorDetails(
  res: Response,
): Promise<{ errorMsg: string; issues?: ApiIssue[] }> {
  let errorMsg = `HTTP ${res.status}: ${res.statusText}`
  let issues: ApiIssue[] | undefined
  try {
    const data = (await res.json()) as {
      error?: string
      message?: string
      issues?: ApiIssue[]
    }
    if (data?.error) {
      errorMsg = data.error
    } else if (data?.message) {
      errorMsg = data.message
    }
    if (Array.isArray(data?.issues)) {
      issues = data.issues
    }
  } catch {
    // response was not JSON
  }
  return { errorMsg, issues }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) {
      onUnauthorizedHandler?.()
    }
    const { errorMsg, issues } = await parseErrorDetails(res)
    throw new ApiClientError(errorMsg, res.status, issues)
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
  const res = await fetch(`${base}/auth/sign-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    await handleResponse(res)
  }
}

function serializePrimitive(params: URLSearchParams, prefix: string, value: unknown) {
  if (value instanceof Date) {
    params.set(prefix, value.toISOString())
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    params.set(prefix, String(value))
  }
}

function serializeQueryParam(params: URLSearchParams, prefix: string, value: unknown) {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      serializeQueryParam(params, `${prefix}[${index}]`, item)
    })
    return
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      serializeQueryParam(params, `${prefix}[${k}]`, v)
    }
    return
  }
  serializePrimitive(params, prefix, value)
}

export interface FetchCollectionDocsOptions {
  page?: number
  limit?: number
  sort?: string
  where?: Where
  draft?: boolean
}

export async function fetchCollectionDocs(
  apiBase: string,
  slug: string,
  options: FetchCollectionDocsOptions = {},
): Promise<PaginatedDocs> {
  const base = apiBase.replace(/\/+$/, '')
  const params = new URLSearchParams()
  if (options.page) params.set('page', String(options.page))
  if (options.limit) params.set('limit', String(options.limit))
  if (options.sort) params.set('sort', options.sort)
  if (options.draft) params.set('draft', 'true')
  if (options.where) serializeQueryParam(params, 'where', options.where)

  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${base}/${slug}${query}`, { credentials: 'include' })
  return handleResponse<PaginatedDocs>(res)
}

export async function fetchDoc(
  apiBase: string,
  slug: string,
  id: number | string,
  options?: { draft?: boolean },
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = options?.draft ? '?draft=true' : ''
  const res = await fetch(`${base}/${slug}/${id}${query}`, { credentials: 'include' })
  return handleResponse<Record<string, unknown>>(res)
}

export async function createDoc(
  apiBase: string,
  slug: string,
  data: Record<string, unknown> | FormData,
  options?: { draft?: boolean },
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData
  const query = options?.draft ? '?draft=true' : ''
  const res = await fetch(`${base}/${slug}${query}`, {
    method: 'POST',
    headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: isFormData ? data : JSON.stringify(data),
  })
  return handleResponse<Record<string, unknown>>(res)
}

function buildUpdateQuery(options?: { draft?: boolean; autosave?: boolean }): string {
  const params = new URLSearchParams()
  if (options?.draft || options?.autosave) params.set('draft', 'true')
  if (options?.autosave) params.set('autosave', 'true')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export async function updateDoc(
  apiBase: string,
  slug: string,
  id: number | string,
  data: Record<string, unknown> | FormData,
  options?: { draft?: boolean; autosave?: boolean },
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData
  const query = buildUpdateQuery(options)
  const res = await fetch(`${base}/${slug}/${id}${query}`, {
    method: 'PATCH',
    headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: isFormData ? data : JSON.stringify(data),
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function publishDoc(
  apiBase: string,
  slug: string,
  id: number | string,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/${slug}/${id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function unpublishDoc(
  apiBase: string,
  slug: string,
  id: number | string,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/${slug}/${id}/unpublish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
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

export interface FetchDocVersionsOptions {
  page?: number
  limit?: number
  sort?: string
}

export async function fetchDocVersions(
  apiBase: string,
  slug: string,
  id: number | string,
  options?: FetchDocVersionsOptions,
): Promise<ClientPaginatedVersions> {
  const base = apiBase.replace(/\/+$/, '')
  const params = new URLSearchParams()
  if (options?.page) params.set('page', String(options.page))
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.sort) params.set('sort', options.sort)
  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${base}/${slug}/${id}/versions${query}`, { credentials: 'include' })
  return handleResponse<ClientPaginatedVersions>(res)
}

export async function fetchDocVersionByID(
  apiBase: string,
  slug: string,
  id: number | string,
  versionId: number | string,
): Promise<ClientVersion> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/${slug}/${id}/versions/${versionId}`, { credentials: 'include' })
  return handleResponse<ClientVersion>(res)
}

export async function restoreDocVersion(
  apiBase: string,
  slug: string,
  id: number | string,
  versionId: number | string,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/${slug}/${id}/versions/${versionId}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function fetchGlobal(
  apiBase: string,
  slug: string,
  options?: { draft?: boolean },
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = options?.draft ? '?draft=true' : ''
  const res = await fetch(`${base}/globals/${slug}${query}`, { credentials: 'include' })
  return handleResponse<Record<string, unknown>>(res)
}

export async function saveGlobal(
  apiBase: string,
  slug: string,
  data: Record<string, unknown>,
  options?: { draft?: boolean; autosave?: boolean },
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const params = new URLSearchParams()
  if (options?.draft) params.set('draft', 'true')
  if (options?.autosave) params.set('autosave', 'true')
  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${base}/globals/${slug}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function publishGlobal(
  apiBase: string,
  slug: string,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/globals/${slug}/publish`, {
    method: 'POST',
    credentials: 'include',
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function unpublishGlobal(
  apiBase: string,
  slug: string,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/globals/${slug}/unpublish`, {
    method: 'POST',
    credentials: 'include',
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function fetchGlobalVersions(
  apiBase: string,
  slug: string,
  options?: { page?: number; limit?: number; sort?: string },
): Promise<ClientPaginatedVersions> {
  const base = apiBase.replace(/\/+$/, '')
  const params = new URLSearchParams()
  if (options?.page) params.set('page', String(options.page))
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.sort) params.set('sort', options.sort)
  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${base}/globals/${slug}/versions${query}`, { credentials: 'include' })
  return handleResponse<ClientPaginatedVersions>(res)
}

export async function restoreGlobalVersion(
  apiBase: string,
  slug: string,
  versionId: number,
  options?: { draft?: boolean },
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = options?.draft !== undefined ? `?draft=${options.draft}` : ''
  const res = await fetch(`${base}/globals/${slug}/versions/${versionId}/restore${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  })
  return handleResponse<Record<string, unknown>>(res)
}
