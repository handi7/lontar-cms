/**
 * Canonical query keys for documents, versions, and globals across the admin panel.
 * Keeps form views, sidebar, version history, and autosave in sync.
 * See issue #233.
 */

export const queryKeys = {
  /** Single collection document */
  document: (slug: string, id: string | number, hasDrafts?: boolean) =>
    ['document', slug, String(id), hasDrafts ? 'draft' : 'published'] as const,

  /** Prefix matching any document query for a given id (both draft and published) */
  documentPrefix: (slug: string, id: string | number) => ['document', slug, String(id)] as const,

  /** Document versions list or prefix for invalidation */
  docVersions: (apiBase: string, slug: string, id: string | number, page?: number) =>
    page !== undefined
      ? (['doc-versions', apiBase, slug, String(id), page] as const)
      : (['doc-versions', apiBase, slug, String(id)] as const),

  /** Single global document */
  global: (slug: string) => ['globals', slug] as const,

  /** Global versions list or prefix for invalidation */
  globalVersions: (apiBase: string, slug: string, page?: number) =>
    page !== undefined
      ? (['global-versions', apiBase, slug, page] as const)
      : (['global-versions', apiBase, slug] as const),

  /** Base permissions for user or anonymous */
  permissions: (apiBase: string, userId?: string | null) =>
    ['_lontar_permissions', apiBase, userId ?? 'anonymous'] as const,

  /** Document-specific permissions */
  documentPermissions: (
    apiBase: string,
    slug: string,
    id: string | number,
    hasDrafts?: boolean,
    userId?: string | null,
  ) =>
    [
      '_lontar_document_permissions',
      apiBase,
      slug,
      String(id),
      hasDrafts ? 'draft' : 'published',
      userId ?? 'anonymous',
    ] as const,

  /** Document-specific permissions prefix for invalidation */
  documentPermissionsPrefix: (apiBase: string, slug: string, id: string | number) =>
    ['_lontar_document_permissions', apiBase, slug, String(id)] as const,

  /** Global-specific permissions */
  globalPermissions: (apiBase: string, slug: string, userId?: string | null) =>
    ['_lontar_global_permissions', apiBase, slug, userId ?? 'anonymous'] as const,

  /** Global-specific permissions prefix for invalidation */
  globalPermissionsPrefix: (apiBase: string, slug: string) =>
    ['_lontar_global_permissions', apiBase, slug] as const,

  /** API keys list for user */
  apiKeys: (apiBase: string, userId?: string | null) =>
    ['_lontar_api_keys', apiBase, userId ?? 'anonymous'] as const,

  /** Users list */
  users: (apiBase: string, page?: number, search?: string, role?: string) =>
    ['_lontar_users', apiBase, page ?? 1, search ?? '', role ?? ''] as const,

  /** Single user */
  user: (apiBase: string, id: string) => ['_lontar_user', apiBase, id] as const,
}
