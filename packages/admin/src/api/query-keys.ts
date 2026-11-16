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
  documentPermissions: (apiBase: string, slug: string, id: string | number, hasDrafts?: boolean) =>
    [
      '_lontar_document_permissions',
      apiBase,
      slug,
      String(id),
      hasDrafts ? 'draft' : 'published',
    ] as const,

  /** Global-specific permissions */
  globalPermissions: (apiBase: string, slug: string) =>
    ['_lontar_global_permissions', apiBase, slug] as const,
}
