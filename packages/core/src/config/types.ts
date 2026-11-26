import type { Context } from 'hono'
import type { Where } from '../query/types'
import type { ApiKeyItem } from '../auth/api-key'
import type { AuthUser, LontarVariables } from '../auth/types'
import type { SystemFieldName, UploadSystemFieldName } from '../client/system-fields'
import type { DatabaseAdapter } from '../database/adapter'
import type { EmailAdapter, EmailConfig } from '../email/types'
import type { AdminComponentKey, Fields } from '../fields/types'
import type { FlattenFields } from '../fields/infer'
import type { LontarClient } from '../local'
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

export interface AuthConfig {
  /** Permitted user roles. Defaults to `['admin', 'editor']`. */
  roles?: readonly string[]
  /** Default role assigned to newly created users. Defaults to `'editor'`. Must be in `roles`. */
  defaultRole?: string
  /** Privileged role for administration and bootstrap. Defaults to `'admin'`. Must be in `roles`. */
  adminRole?: string
  /** Require email verification before users can sign in. Defaults to `false`. */
  requireEmailVerification?: boolean
}

export interface AccessArgs<TData = unknown> {
  user: AuthUser | null
  id?: number
  data?: TData
  req?: Request
  locale?: string
}

export type AccessFunction<TData = unknown> = (
  args: AccessArgs<TData>,
) => boolean | Promise<boolean>

/**
 * What a row-level access function returns: `true` for every document, `false` for none, or a
 * `Where` constraint that limits the operation to the documents it matches (ADR 0030).
 */
export type AccessResult = boolean | Where

export type ConstraintAccessFunction<TData = unknown> = (
  args: AccessArgs<TData>,
) => AccessResult | Promise<AccessResult>

export interface CollectionAccess {
  /** May return a constraint. */
  read?: ConstraintAccessFunction
  /** Boolean only: there is no existing row for a constraint to select. */
  create?: AccessFunction
  /** May return a constraint. */
  update?: ConstraintAccessFunction
  /** May return a constraint. */
  delete?: ConstraintAccessFunction
}

export interface GlobalAccess {
  read?: AccessFunction
  update?: AccessFunction
}

export type EndpointMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** The second argument of an endpoint handler (ADR 0029). */
export interface EndpointContext {
  user: AuthUser | null
  /** Set when the request authenticated with an API key. */
  apiKey: ApiKeyItem | null
  /** Parsed from `:id`. Requests with an invalid id are answered with 400 before the handler runs. */
  id?: number
  /** From `?locale`, as REST does. */
  locale?: string
  config: Config
  /**
   * The Local API bound to the caller: `overrideAccess: false` and `user` are preset. Pass
   * `overrideAccess: true` explicitly when the handler needs elevated access.
   */
  lontar: LontarClient
}

export interface EndpointRateLimit {
  /** Time window in seconds. */
  window: number
  /** Maximum requests per client IP within the window. */
  max: number
}

export type EndpointHandler = (
  c: Context<{ Variables: LontarVariables }>,
  ctx: EndpointContext,
) => Response | Promise<Response>

/** A server route beyond CRUD, with Lontar's session, access control and rate limiting. */
export interface Endpoint {
  /** Unique within where it is declared. Actions refer to an endpoint by name. */
  name: string
  method: EndpointMethod
  /** Starts with `/`. Collection endpoints may use `:id`; see ADR 0029 for the reserved paths. */
  path: string
  /** Omitted means any authenticated user. Write `access: () => true` for a public endpoint. */
  access?: AccessFunction
  /** Accept API key requests. Defaults to false: a key request gets 403. */
  apiKey?: boolean
  /** Keyed by client IP and endpoint. No default limit. */
  rateLimit?: EndpointRateLimit
  handler: EndpointHandler
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
  /** Whether to bypass access control when generating payload.doc. Defaults to true. */
  overrideAccess?: boolean
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
  /** Whether to bypass access control when generating payload.doc. Defaults to true. */
  overrideAccess?: boolean
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
  /** Whether to bypass access control when generating payload.doc. Defaults to true. */
  overrideAccess?: boolean
}

export interface PreviewConfig {
  /** URL template for live preview, e.g. 'https://mysite.com/posts/{slug}?preview=1'. */
  url: string
}

export interface GlobalAdmin {
  preview?: PreviewConfig
  /** Declarative actions shown in the edit view document sidebar (ADR 0029). */
  actions?: readonly ActionConfig[]
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
  /** Custom endpoints mounted at `<basePath>/globals/<slug><path>`. */
  endpoints?: readonly Endpoint[]
  fields: F
}

export type ActionScope = 'row' | 'document' | 'bulk'

export type ActionVariant = 'default' | 'destructive' | 'secondary' | 'outline' | 'ghost' | 'link'

/** Declarative action descriptor that binds a button to an endpoint or dialog component (ADR 0029). */
export interface ActionConfig {
  key: string
  label: string
  scope: ActionScope | readonly ActionScope[]
  endpoint?: string
  component?: string
  confirm?: string
  variant?: ActionVariant
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
  /** Declarative actions shown in row menu, selection bar, and document sidebar (ADR 0029). */
  actions?: readonly ActionConfig[]
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
  | (keyof FlattenFields<F> & string)
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
  /** Custom endpoints mounted at `<basePath>/<slug><path>`. */
  endpoints?: readonly Endpoint[]
  /** Authored as an object for type inference; order is preserved in ClientConfig. */
  fields: F
}

export interface LocaleObject {
  code: string
  label?: string
}

export type LocaleConfig = string | LocaleObject

export interface LocalizationConfig {
  /** List of configured locales (locale codes or { code, label } objects). */
  locales: readonly LocaleConfig[]
  /** Default locale code. Must be one of the configured locales. */
  defaultLocale: string
  /** Whether to fall back to defaultLocale when a translation is missing. Defaults to true. */
  fallback?: boolean
}

export type DashboardWidgetWidth = 'full' | 'half'

/** A registered component rendered on the dashboard (ADR 0029). */
export interface DashboardWidget {
  /** Key of a component registered on `<Admin components>`. */
  component: AdminComponentKey
  /** `'full'` spans the dashboard's width, `'half'` takes half of it. Defaults to `'full'`. */
  width?: DashboardWidgetWidth
}

export interface DashboardConfig {
  /** Rendered above the collection cards, in this order. */
  widgets?: readonly DashboardWidget[]
}

/** A screen served by a registered component, with a sidebar entry (ADR 0029). */
export interface CustomView {
  /** The last segment of `<adminBasePath>/views/<key>`: lowercase letters, digits and hyphens. */
  key: string
  /** The sidebar entry and the page title. */
  label: string
  /** Key of a component registered on `<Admin components>`. */
  component: AdminComponentKey
  /**
   * Decides whether the admin shows the view to this user. Evaluated by the permissions endpoint;
   * only the boolean reaches the admin, and hiding a view is cosmetic, so the endpoints it calls
   * must enforce access. Omitted means any authenticated user.
   */
  access?: AccessFunction
}

/** Admin-wide extensions that are not tied to one collection or global (ADR 0029). */
export interface AdminConfig {
  dashboard?: DashboardConfig
  views?: readonly CustomView[]
}

/** Server-only. Never sent to the admin; see toClientConfig(). */
export interface Config {
  /** Signs sessions. */
  secret: string
  db: DatabaseAdapter
  /** Authentication and user roles configuration. */
  auth?: AuthConfig
  /** Optional file storage adapter. Required when any collection has upload enabled. */
  storage?: StorageAdapter
  /** Optional email delivery adapter and templates. Required for password reset, user invitation, and email verification. */
  email?: EmailAdapter | EmailConfig
  /** Optional global pagination settings. */
  pagination?: PaginationConfig
  /** Optional content localization settings. */
  localization?: LocalizationConfig
  /** Outgoing webhooks triggered by collection and global events. */
  webhooks?: readonly WebhookConfig[]
  /** Custom endpoints mounted at `<basePath><path>`. */
  endpoints?: readonly Endpoint[]
  /** Dashboard widgets and custom views that refer to registered admin components. */
  admin?: AdminConfig
  collections: readonly CollectionConfig[]
  globals?: readonly GlobalConfig[]
}
