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
}

export interface GlobalPermission {
  read: boolean
  update: boolean
  readVersions: boolean
  fields: Record<string, FieldPermission>
}

export interface PermissionsResponse {
  collections: Record<string, CollectionPermission>
  globals: Record<string, GlobalPermission>
}
