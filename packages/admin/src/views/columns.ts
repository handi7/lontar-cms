import type { ClientCollection, FieldPermission } from '@lontar/core/client'

const SYSTEM_KEYS = new Set(['id', '_status', 'createdAt', 'updatedAt'])

// A table cell cannot show these in a useful way, so the picker does not offer them. A collection
// can still list one in `admin.defaultColumns`.
const UNPICKABLE_TYPES = new Set(['group', 'array', 'blocks', 'richText'])

export function getColumnLabel(key: string, collection: ClientCollection): string {
  if (key === 'id') return 'ID'
  if (key === '_status') return 'Status'
  if (key === 'createdAt') return 'Created At'
  if (key === 'updatedAt') return 'Updated At'
  const field = collection.fields.find((f) => f.name === key)
  return field?.label ?? key
}

function isNestedPathReadable(
  parts: string[],
  fieldPermissions: Record<string, FieldPermission>,
): boolean {
  let curr: FieldPermission | undefined = fieldPermissions[parts[0] ?? '']
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      curr = curr?.fields?.[parts[i] ?? '']
    }
    if (curr?.read === false) return false
  }
  return true
}

export function isColumnReadable(
  key: string,
  fieldPermissions?: Record<string, FieldPermission>,
): boolean {
  if (!fieldPermissions || SYSTEM_KEYS.has(key)) return true
  if (key.includes('.')) {
    return isNestedPathReadable(key.split('.'), fieldPermissions)
  }
  return fieldPermissions[key]?.read !== false
}

/** The collection's own column set, before any per-user choice and before permissions. */
function configuredColumnKeys(collection: ClientCollection): string[] {
  const keys =
    collection.admin.defaultColumns.length > 0
      ? [...collection.admin.defaultColumns]
      : ['id', ...collection.fields.map((f) => f.name), 'createdAt']

  if (collection.versions?.drafts && !keys.includes('_status')) {
    const createdAtIndex = keys.indexOf('createdAt')
    if (createdAtIndex !== -1) {
      keys.splice(createdAtIndex, 0, '_status')
    } else {
      keys.push('_status')
    }
  }
  return keys
}

export function defaultColumnKeys(
  collection: ClientCollection,
  fieldPermissions?: Record<string, FieldPermission>,
): string[] {
  return configuredColumnKeys(collection).filter((key) => isColumnReadable(key, fieldPermissions))
}

/**
 * Every column the user may show, in a stable order: the defaults first, then the rest of the
 * fields, then the remaining system columns. Fields the user cannot read are left out (#341).
 */
export function selectableColumnKeys(
  collection: ClientCollection,
  fieldPermissions?: Record<string, FieldPermission>,
): string[] {
  const keys = new Set(configuredColumnKeys(collection))
  for (const field of collection.fields) {
    if (!UNPICKABLE_TYPES.has(field.type)) keys.add(field.name)
  }
  keys.add('id')
  keys.add('updatedAt')
  keys.add('createdAt')
  return [...keys].filter((key) => isColumnReadable(key, fieldPermissions))
}

/** The title column is how a row is recognised and linked, so it is always shown. */
export function titleColumnKey(collection: ClientCollection): string {
  return collection.admin.useAsTitle || 'id'
}

/**
 * Turns a stored choice into the columns to render. Keys that no longer exist in the config, or
 * that the user can no longer read, are ignored; the title column is forced back in; and an empty
 * result falls back to the defaults.
 */
export function resolveColumnKeys(
  collection: ClientCollection,
  fieldPermissions: Record<string, FieldPermission> | undefined,
  stored: readonly string[] | null,
): string[] {
  const defaults = defaultColumnKeys(collection, fieldPermissions)
  if (!stored) return defaults

  const wanted = new Set(stored)
  const title = titleColumnKey(collection)
  const selectable = selectableColumnKeys(collection, fieldPermissions)
  if (selectable.includes(title)) wanted.add(title)

  const keys = selectable.filter((key) => wanted.has(key))
  return keys.length > 0 ? keys : defaults
}

export function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i])
}

const STORAGE_PREFIX = 'lontar-admin-columns'

export function columnsStorageKey(userId: string | null, slug: string): string {
  return `${STORAGE_PREFIX}:${userId ?? 'anonymous'}:${slug}`
}

// localStorage can be missing or throw (private windows, blocked site data, a full quota), and a
// stored value may have been edited by hand. Neither may break the list.
export function readStoredColumns(storageKey: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === 'string')) return null
    return parsed
  } catch {
    return null
  }
}

export function writeStoredColumns(storageKey: string, keys: readonly string[] | null): void {
  try {
    if (keys === null) window.localStorage.removeItem(storageKey)
    else window.localStorage.setItem(storageKey, JSON.stringify(keys))
  } catch {
    // The choice still applies for this session.
  }
}
