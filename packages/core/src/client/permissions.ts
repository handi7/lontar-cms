export interface FieldPermission {
  read: boolean
  create: boolean
  update: boolean
  fields?: Record<string, FieldPermission>
  blocks?: Record<string, { fields: Record<string, FieldPermission> }>
}

export interface CollectionPermission {
  create: boolean
  /**
   * For a collection, "at least some documents" when `constrained.read` is set; for one
   * document, exactly that document. The same holds for `update` and `delete`.
   */
  read: boolean
  update: boolean
  delete: boolean
  readVersions: boolean
  /**
   * Present only for an operation whose access function returned a row-level constraint
   * (ADR 0030 §10). In the answer for one document it is omitted, because that answer is exact.
   */
  constrained?: { read?: boolean; update?: boolean; delete?: boolean }
  fields: Record<string, FieldPermission>
  /**
   * Whether each declarative action is available to the current user, by action key.
   * Evaluated against each action endpoint's `access` with `{ user }` only (ADR 0029).
   */
  actions?: Record<string, boolean>
}

export interface GlobalPermission {
  read: boolean
  update: boolean
  readVersions: boolean
  fields: Record<string, FieldPermission>
  /**
   * Whether each declarative action is available to the current user, by action key.
   * Evaluated against each action endpoint's `access` with `{ user }` only (ADR 0029).
   */
  actions?: Record<string, boolean>
}

export interface PermissionsResponse {
  collections: Record<string, CollectionPermission>
  globals: Record<string, GlobalPermission>
  /**
   * Whether the user may see each custom view, by key. Present only when the config has views.
   * Cosmetic: the endpoints a view calls enforce access.
   */
  views?: Record<string, boolean>
}
