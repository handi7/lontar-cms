import type { AuthUser } from '../auth/types'
import type { SystemFieldName } from '../client/system-fields'
import type { DatabaseAdapter } from '../database/adapter'
import type { Fields } from '../fields/types'

export interface AccessArgs<TData = unknown> {
  user: AuthUser | null
  id?: number
  data?: TData
}

export type AccessFunction<TData = unknown> = (
  args: AccessArgs<TData>,
) => boolean | Promise<boolean>

export interface CollectionAccess {
  read?: AccessFunction
  create?: AccessFunction
  update?: AccessFunction
  delete?: AccessFunction
}

/**
 * `Name` is narrowed to the collection's own field names by collection(). It is
 * not tied to `F` here: `keyof F` would make CollectionConfig invariant in `F`,
 * and a specific collection would no longer be assignable to CollectionConfig.
 */
export interface CollectionAdmin<Name extends string = string> {
  /** Field shown as the document title. Defaults to `id`. */
  useAsTitle?: Name
  /** Columns of the list view. Defaults to the title and the next few fields. */
  defaultColumns?: Name[]
}

export type FieldName<F extends Fields> = (keyof F & string) | SystemFieldName

export interface CollectionConfig<F extends Fields = Fields> {
  /** Used in URLs and as the table name. Kebab-case: `posts`, `blog-posts`. */
  slug: string
  labels?: { singular?: string; plural?: string }
  admin?: CollectionAdmin
  access?: CollectionAccess
  /** Authored as an object for type inference; order is preserved in ClientConfig. */
  fields: F
}

/** Server-only. Never sent to the admin; see toClientConfig(). */
export interface Config {
  /** Signs sessions. */
  secret: string
  db: DatabaseAdapter
  collections: readonly CollectionConfig[]
}
