import type {
  ClientConfig,
  ClientPaginatedVersions,
  ClientVersion,
  CollectionPermission,
  GlobalPermission,
  PermissionsResponse,
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
  readonly retryAfter?: number

  constructor(message: string, status: number, issues?: ApiIssue[], retryAfter?: number) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.issues = issues
    this.retryAfter = retryAfter
  }
}

export { queryKeys } from './query-keys'

function formatRateLimitMessage(retryAfter?: number): string {
  if (retryAfter) {
    return `Too many requests. Please try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`
  }
  return 'Too many requests. Please try again later.'
}

export function formatApiErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 429) {
      return formatRateLimitMessage(err.retryAfter)
    }
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
    const retryHeader = res.headers?.get
      ? (res.headers.get('retry-after') ?? res.headers.get('x-retry-after'))
      : null
    const retryAfter = retryHeader ? parseInt(retryHeader, 10) : undefined
    const { errorMsg, issues } = await parseErrorDetails(res)
    throw new ApiClientError(
      errorMsg,
      res.status,
      issues,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    )
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

export interface FetchDocOptions {
  draft?: boolean
  locale?: string
  fallbackLocale?: string | false
}

export interface CreateDocOptions {
  draft?: boolean
  locale?: string
}

export interface UpdateDocOptions {
  draft?: boolean
  autosave?: boolean
  locale?: string
}

export interface PublishDocOptions {
  locale?: string
}

export interface FetchGlobalOptions {
  draft?: boolean
  locale?: string
  fallbackLocale?: string | false
}

export interface SaveGlobalOptions {
  draft?: boolean
  autosave?: boolean
  locale?: string
}

export interface PublishGlobalOptions {
  locale?: string
}

function buildDocQuery(options?: {
  draft?: boolean
  autosave?: boolean
  locale?: string
  fallbackLocale?: string | false
}): string {
  if (!options) return ''
  const params = new URLSearchParams()
  if (options.draft || options.autosave) params.set('draft', 'true')
  if (options.autosave) params.set('autosave', 'true')
  if (options.locale) params.set('locale', options.locale)
  if (options.fallbackLocale !== undefined)
    params.set('fallbackLocale', String(options.fallbackLocale))
  const query = params.toString()
  return query ? `?${query}` : ''
}

export async function fetchDoc(
  apiBase: string,
  slug: string,
  id: number | string,
  options?: FetchDocOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = buildDocQuery(options)
  const res = await fetch(`${base}/${slug}/${id}${query}`, { credentials: 'include' })
  return handleResponse<Record<string, unknown>>(res)
}

export async function createDoc(
  apiBase: string,
  slug: string,
  data: Record<string, unknown> | FormData,
  options?: CreateDocOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData
  const query = buildDocQuery(options)
  const res = await fetch(`${base}/${slug}${query}`, {
    method: 'POST',
    headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: isFormData ? data : JSON.stringify(data),
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function updateDoc(
  apiBase: string,
  slug: string,
  id: number | string,
  data: Record<string, unknown> | FormData,
  options?: UpdateDocOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData
  const query = buildDocQuery(options)
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
  options?: PublishDocOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = buildDocQuery(options)
  const res = await fetch(`${base}/${slug}/${id}/publish${query}`, {
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
  options?: PublishDocOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = buildDocQuery(options)
  const res = await fetch(`${base}/${slug}/${id}/unpublish${query}`, {
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
  options?: FetchGlobalOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = buildDocQuery(options)
  const res = await fetch(`${base}/globals/${slug}${query}`, { credentials: 'include' })
  return handleResponse<Record<string, unknown>>(res)
}

export async function saveGlobal(
  apiBase: string,
  slug: string,
  data: Record<string, unknown>,
  options?: SaveGlobalOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = buildDocQuery(options)
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
  options?: PublishGlobalOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = buildDocQuery(options)
  const res = await fetch(`${base}/globals/${slug}/publish${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  })
  return handleResponse<Record<string, unknown>>(res)
}

export async function unpublishGlobal(
  apiBase: string,
  slug: string,
  options?: PublishGlobalOptions,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/+$/, '')
  const query = buildDocQuery(options)
  const res = await fetch(`${base}/globals/${slug}/unpublish${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function fetchPermissions(apiBase: string): Promise<PermissionsResponse> {
  const url = `${apiBase.replace(/\/+$/, '')}/_lontar/permissions`
  const res = await fetch(url, { credentials: 'include' })
  return handleResponse<PermissionsResponse>(res)
}

export async function fetchDocumentPermissions(
  apiBase: string,
  collection: string,
  id: string | number,
  options?: { draft?: boolean },
): Promise<CollectionPermission> {
  const base = apiBase.replace(/\/+$/, '')
  const query = options?.draft ? '?draft=true' : ''
  const res = await fetch(`${base}/_lontar/permissions/${collection}/${id}${query}`, {
    credentials: 'include',
  })
  return handleResponse<CollectionPermission>(res)
}

export async function fetchGlobalPermissions(
  apiBase: string,
  slug: string,
): Promise<GlobalPermission> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/permissions/globals/${slug}`, {
    credentials: 'include',
  })
  return handleResponse<GlobalPermission>(res)
}

export interface UserDoc {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  banReason?: string | null
  banExpires?: string | Date | null
  image?: string | null
  createdAt?: string | Date
  updatedAt?: string | Date
  [key: string]: unknown
}

export interface PaginatedUsers {
  docs: UserDoc[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  pagingCounter: number
  hasNextPage: boolean
  hasPrevPage: boolean
  prevPage: number | null
  nextPage: number | null
}

export interface CreateUserData {
  email: string
  name: string
  role?: string
  password?: string
  invite?: boolean
}

export interface UpdateUserData {
  name?: string
  role?: string
}

export interface ChangePasswordData {
  currentPassword: string
  newPassword: string
}

export async function fetchUsers(
  apiBase: string,
  options?: { page?: number; limit?: number; search?: string; role?: string },
): Promise<PaginatedUsers> {
  const base = apiBase.replace(/\/+$/, '')
  const params = new URLSearchParams()
  if (options?.page) params.set('page', String(options.page))
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.search) params.set('search', options.search)
  if (options?.role) params.set('role', options.role)
  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${base}/_lontar/users${query}`, { credentials: 'include' })
  return handleResponse<PaginatedUsers>(res)
}

export async function fetchUserById(apiBase: string, id: string): Promise<UserDoc> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users/${id}`, { credentials: 'include' })
  const data = await handleResponse<{ user: UserDoc }>(res)
  return data.user
}

export async function createUser(apiBase: string, data: CreateUserData): Promise<UserDoc> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  const resData = await handleResponse<{ user: UserDoc }>(res)
  return resData.user
}

export async function updateUser(
  apiBase: string,
  id: string,
  data: UpdateUserData,
): Promise<UserDoc> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  const resData = await handleResponse<{ user: UserDoc }>(res)
  return resData.user
}

export async function disableUser(
  apiBase: string,
  id: string,
  reason?: string,
): Promise<{ message: string; user: UserDoc }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users/${id}/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(reason ? { reason } : {}),
  })
  return handleResponse<{ message: string; user: UserDoc }>(res)
}

export async function enableUser(
  apiBase: string,
  id: string,
): Promise<{ message: string; user: UserDoc }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users/${id}/enable`, {
    method: 'POST',
    credentials: 'include',
  })
  return handleResponse<{ message: string; user: UserDoc }>(res)
}

export async function revokeUserSessions(
  apiBase: string,
  id: string,
): Promise<{ message: string }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users/${id}/revoke-sessions`, {
    method: 'POST',
    credentials: 'include',
  })
  return handleResponse<{ message: string }>(res)
}

export async function adminSetUserPassword(
  apiBase: string,
  id: string,
  password: string,
): Promise<{ message: string }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users/${id}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password }),
  })
  return handleResponse<{ message: string }>(res)
}

export async function deleteUser(apiBase: string, id: string): Promise<{ message: string }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return handleResponse<{ message: string }>(res)
}

export async function updateMe(apiBase: string, data: { name: string }): Promise<UserDoc> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  const resData = await handleResponse<{ user: UserDoc }>(res)
  return resData.user
}

export async function changeMyPassword(
  apiBase: string,
  data: ChangePasswordData,
): Promise<{ message: string }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/me/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  return handleResponse<{ message: string }>(res)
}

export async function requestPasswordReset(
  apiBase: string,
  email: string,
): Promise<{ status: boolean; message: string }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/auth/request-password-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  })
  return handleResponse<{ status: boolean; message: string }>(res)
}

export async function resetPassword(
  apiBase: string,
  data: { token: string; newPassword: string },
): Promise<{ status: boolean }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  return handleResponse<{ status: boolean }>(res)
}

export async function verifyEmail(
  apiBase: string,
  token: string,
): Promise<{ status: boolean; user?: unknown }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/auth/verify-email?token=${encodeURIComponent(token)}`, {
    method: 'GET',
    credentials: 'include',
  })
  return handleResponse<{ status: boolean; user?: unknown }>(res)
}

export async function resendUserInvite(
  apiBase: string,
  id: string,
): Promise<{ success: boolean; message: string }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/users/${id}/resend-invite`, {
    method: 'POST',
    credentials: 'include',
  })
  return handleResponse<{ success: boolean; message: string }>(res)
}

export interface ApiKeyDoc {
  id: string
  name: string
  start: string
  userId: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

export interface CreatedApiKeyDoc extends ApiKeyDoc {
  key: string
}

export interface CreateApiKeyData {
  name: string
  expiresIn?: number | null
  userId?: string
}

export async function listApiKeys(apiBase: string, userId?: string): Promise<ApiKeyDoc[]> {
  const base = apiBase.replace(/\/+$/, '')
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : ''
  const res = await fetch(`${base}/_lontar/api-keys${query}`, {
    credentials: 'include',
  })
  const data = await handleResponse<{ docs: ApiKeyDoc[] }>(res)
  return data.docs
}

export async function createApiKey(
  apiBase: string,
  data: CreateApiKeyData,
): Promise<CreatedApiKeyDoc> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  const resData = await handleResponse<{ apiKey: CreatedApiKeyDoc }>(res)
  return resData.apiKey
}

export async function revokeApiKey(apiBase: string, id: string): Promise<{ success: boolean }> {
  const base = apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/_lontar/api-keys/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return handleResponse<{ success: boolean }>(res)
}
