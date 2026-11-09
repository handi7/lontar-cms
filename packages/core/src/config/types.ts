import type { AuthUser } from '../auth/types'
import type { SystemFieldName, UploadSystemFieldName } from '../client/system-fields'
import type { DatabaseAdapter } from '../database/adapter'
import type { Fields } from '../fields/types'
import type {
  AfterChangeHook,
  AfterDeleteHook,
  AfterReadHook,
  BeforeChangeHook,
  BeforeDeleteHook,
  BeforeValidateHook,
  CollectionHooks,
} from '../hooks/types'
import type { StorageAdapter } from '../storage/adapter'
import type { UploadConfig } from '../storage/image'

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

export interface GlobalAccess {
  read?: AccessFunction
  update?: AccessFunction
}

export interface GlobalHooks {
  beforeValidate?: BeforeValidateHook[]
  beforeChange?: BeforeChangeHook[]
  afterChange?: AfterChangeHook[]
  afterRead?: AfterReadHook[]
  beforeDelete?: BeforeDeleteHook[]
  afterDelete?: AfterDeleteHook[]
}

export interface VersionsAutosaveConfig {
  /** Debounce interval in milliseconds. Defaults to 2000 (2s). Minimum 500ms. */
  interval?: number
}

export interface VersionsConfig {
  /** When true (or object), enables draft/publish lifecycle and adds `_status` system field. */
  drafts?: boolean | { autosave?: boolean | VersionsAutosaveConfig }
  /** Autosave options when drafts are enabled. */
  autosave?: boolean | VersionsAutosaveConfig
  /** Maximum historical versions retained per document. Defaults to 50; 0 for unlimited. */
  maxPerDoc?: number
}

export type WebhookEvent = 'publish' | 'unpublish' | 'create' | 'update' | 'delete' | 'change'

export interface WebhookConfig {
  /** Target URL to send HTTP POST webhook request. */
  url: string
  /** Collection slugs to receive webhooks for, or '*' for all collections. */
  collections?: readonly string[] | '*'
  /** Global slugs to receive webhooks for, or '*' for all globals. */
  globals?: readonly string[] | '*'
  /** Events that trigger this webhook. */
  events: readonly WebhookEvent[]
  /** Secret used for HMAC-SHA256 signature in `x-lontar-signature-256`. */
  secret?: string
  /** Whether to include the full document snapshot in the payload. Defaults to false. */
  includeDoc?: boolean
}

export interface CollectionWebhookConfig {
  /** Target URL to send HTTP POST webhook request. */
  url: string
  /** Events that trigger this webhook. */
  events: readonly WebhookEvent[]
  /** Secret used for HMAC-SHA256 signature in `x-lontar-signature-256`. */
  secret?: string
  /** Whether to include the full document snapshot in the payload. Defaults to false. */
  includeDoc?: boolean
}

export interface GlobalWebhookConfig {
  /** Target URL to send HTTP POST webhook request. */
  url: string
  /** Events that trigger this webhook. */
  events: readonly WebhookEvent[]
  /** Secret used for HMAC-SHA256 signature in `x-lontar-signature-256`. */
  secret?: string
  /** Whether to include the full document snapshot in the payload. Defaults to false. */
  includeDoc?: boolean
}

export interface PreviewConfig {
  /** URL template for live preview, e.g. 'https://mysite.com/posts/{slug}?preview=1'. */
  url: string
}

export interface GlobalAdmin {
  preview?: PreviewConfig
}

export interface GlobalConfig<F extends Fields = Fields> {
  slug: string
  label?: string
  admin?: GlobalAdmin
  access?: GlobalAccess
  hooks?: GlobalHooks
  versions?: VersionsConfig
  /** Outgoing webhooks triggered by global events. */
  webhooks?: readonly GlobalWebhookConfig[]
  fields: F
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
  /** Live preview configuration. */
  preview?: PreviewConfig
}

export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 100
export const DEFAULT_MAX_PER_DOC = 50

export interface PaginationConfig {
  /** Default number of documents per page. Defaults to 10. */
  defaultLimit?: number
  /** Maximum allowable limit in pagination queries. Defaults to 100. */
  maxLimit?: number
}

export type FieldName<F extends Fields, C = unknown> =
  | (keyof F & string)
  | SystemFieldName
  | (C extends { upload: true | object } | true | UploadConfig ? UploadSystemFieldName : never)

export interface CollectionConfig<F extends Fields = Fields> {
  /** Used in URLs and as the table name. Kebab-case: `posts`, `blog-posts`. */
  slug: string
  labels?: { singular?: string; plural?: string }
  admin?: CollectionAdmin
  access?: CollectionAccess
  hooks?: CollectionHooks
  /** Enables file upload support and image resizing for this collection. */
  upload?: boolean | UploadConfig
  /** Optional pagination settings (default and max limit). */
  pagination?: PaginationConfig
  /** Optional versioning and draft settings. */
  versions?: VersionsConfig
  /** Outgoing webhooks triggered by collection events. */
  webhooks?: readonly CollectionWebhookConfig[]
  /** Authored as an object for type inference; order is preserved in ClientConfig. */
  fields: F
}

/** Server-only. Never sent to the admin; see toClientConfig(). */
export interface Config {
  /** Signs sessions. */
  secret: string
  db: DatabaseAdapter
  /** Optional file storage adapter. Required when any collection has upload enabled. */
  storage?: StorageAdapter
  /** Optional global pagination settings. */
  pagination?: PaginationConfig
  /** Outgoing webhooks triggered by collection and global events. */
  webhooks?: readonly WebhookConfig[]
  collections: readonly CollectionConfig[]
  globals?: readonly GlobalConfig[]
}
