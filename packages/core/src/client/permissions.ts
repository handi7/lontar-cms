export interface FieldPermission {
  read: boolean
  create: boolean
  update: boolean
  fields?: Record<string, FieldPermission>
  blocks?: Record<string, { fields: Record<string, FieldPermission> }>
}

export interface CollectionPermission {
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
  readVersions: boolean
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
