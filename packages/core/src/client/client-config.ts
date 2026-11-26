import type { FieldCondition } from './condition'

/** Bumped whenever the shape below changes incompatibly. */
export const CLIENT_CONFIG_VERSION = 4

export interface ClientAuthConfig {
  roles: string[]
  defaultRole: string
  adminRole: string
  emailEnabled: boolean
}

export interface ClientLocale {
  code: string
  label: string
}

export interface ClientLocalizationConfig {
  locales: ClientLocale[]
  defaultLocale: string
  fallback: boolean
}

/**
 * Everything the admin knows about the config, served as JSON from
 * `GET /api/_lontar/config`. Plain data only: it must survive
 * `JSON.parse(JSON.stringify(x))` unchanged. See docs/adr/0003-client-config-format.md.
 */
export interface ClientDashboardWidget {
  /** Key of the host component registered on `<Admin components>`. */
  component: string
  width: 'full' | 'half'
}

export interface ClientCustomView {
  key: string
  label: string
  /** Key of the host component registered on `<Admin components>`. The access function stays on the server. */
  component: string
}

export interface ClientAdminConfig {
  dashboard?: { widgets: ClientDashboardWidget[] }
  views?: ClientCustomView[]
}

export interface ClientConfig {
  version: typeof CLIENT_CONFIG_VERSION
  localization?: ClientLocalizationConfig
  auth?: ClientAuthConfig
  /** Present only when the config sets `admin`. */
  admin?: ClientAdminConfig
  collections: ClientCollection[]
  globals: ClientGlobal[]
}

export interface ClientPreviewConfig {
  url: string
}

export type ActionScope = 'row' | 'document' | 'bulk'

export type ActionVariant = 'default' | 'destructive' | 'secondary' | 'outline' | 'ghost' | 'link'

export type ClientEndpointMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface ClientAction {
  key: string
  label: string
  scope: ActionScope[]
  endpoint?: string
  component?: string
  confirm?: string
  variant?: ActionVariant
  path?: string
  method?: ClientEndpointMethod
}

export interface ClientGlobalAdmin {
  preview?: ClientPreviewConfig
  actions?: ClientAction[]
}

export interface ClientGlobal {
  slug: string
  label: string
  admin?: ClientGlobalAdmin
  versions?: ClientVersionsConfig
  /** In config order. System fields are not listed. */
  fields: ClientField[]
}

export interface ClientVersionsAutosaveConfig {
  interval: number
}

export interface ClientVersionsConfig {
  drafts?: boolean
  autosave?: ClientVersionsAutosaveConfig
  maxPerDoc?: number
}

export interface ClientUploadConfig {
  mimeTypes?: string[]
  maxFileSize?: number
}

export interface ClientPaginationConfig {
  defaultLimit?: number
  maxLimit?: number
}

export interface ClientCollectionAdmin {
  useAsTitle: string
  defaultColumns: string[]
  preview?: ClientPreviewConfig
  actions?: ClientAction[]
}

export interface ClientCollection {
  slug: string
  labels: { singular: string; plural: string }
  admin: ClientCollectionAdmin
  upload?: boolean | ClientUploadConfig
  pagination?: ClientPaginationConfig
  versions?: ClientVersionsConfig
  /** In config order. System fields are not listed: every document has them. */
  fields: ClientField[]
}

export interface ClientFieldBase {
  name: string
  label: string
  required: boolean
  localized?: boolean
  condition?: FieldCondition
  /** Key of the host component that replaces this field's input (`admin.component`). */
  component?: string
}

export interface ClientTextField extends ClientFieldBase {
  type: 'text'
  hasMany?: boolean
  minRows?: number
  maxRows?: number
  minLength?: number
  maxLength?: number
  defaultValue?: string | string[]
}

export interface ClientNumberField extends ClientFieldBase {
  type: 'number'
  hasMany?: boolean
  minRows?: number
  maxRows?: number
  min?: number
  max?: number
  integer?: boolean
  defaultValue?: number | number[]
}

export interface ClientTextareaField extends ClientFieldBase {
  type: 'textarea'
  minLength?: number
  maxLength?: number
  rows?: number
  defaultValue?: string
}

export interface ClientCodeField extends ClientFieldBase {
  type: 'code'
  language?: string
  minLength?: number
  maxLength?: number
  defaultValue?: string
}

export interface ClientJsonField extends ClientFieldBase {
  type: 'json'
  maxBytes?: number
  defaultValue?: unknown
}

export interface ClientEmailField extends ClientFieldBase {
  type: 'email'
  unique?: boolean
  defaultValue?: string
  maxLength?: number
}

export interface ClientSlugField extends ClientFieldBase {
  type: 'slug'
  from?: string
  unique?: boolean
  defaultValue?: string
  maxLength?: number
}

export interface ClientCheckboxField extends ClientFieldBase {
  type: 'checkbox'
  defaultValue?: boolean
}

export interface ClientSelectOption {
  label: string
  value: string
}

export interface ClientSelectField extends ClientFieldBase {
  type: 'select'
  options: ClientSelectOption[]
  defaultValue?: string
}

export type ClientRadioLayout = 'horizontal' | 'vertical'

export interface ClientRadioField extends ClientFieldBase {
  type: 'radio'
  options: ClientSelectOption[]
  layout: ClientRadioLayout
  defaultValue?: string
}

export interface ClientPointField extends ClientFieldBase {
  type: 'point'
  defaultValue?: [number, number]
}

export interface ClientDateField extends ClientFieldBase {
  type: 'date'
  defaultValue?: string
}

export interface ClientRichTextField extends ClientFieldBase {
  type: 'richText'
  defaultValue?: Record<string, unknown>
}

export interface ClientRelationshipField extends ClientFieldBase {
  type: 'relationship'
  relationTo: string
  hasMany?: boolean
}

export interface ClientUploadField extends ClientFieldBase {
  type: 'upload'
  relationTo: string
}

export interface ClientGroupField extends ClientFieldBase {
  type: 'group'
  fields: ClientField[]
}

export interface ClientArrayFieldAdmin {
  description?: string
  rowLabel?: string
}

export interface ClientArrayField extends ClientFieldBase {
  type: 'array'
  fields: ClientField[]
  minRows?: number
  maxRows?: number
  labels?: { singular: string; plural: string }
  admin?: ClientArrayFieldAdmin
}

export interface ClientBlock {
  slug: string
  labels: { singular: string; plural: string }
  fields: ClientField[]
}

export interface ClientBlocksFieldAdmin {
  description?: string
}

export interface ClientBlocksField extends ClientFieldBase {
  type: 'blocks'
  blocks: ClientBlock[]
  minRows?: number
  maxRows?: number
  labels?: { singular: string; plural: string }
  admin?: ClientBlocksFieldAdmin
}

export interface ClientTabAdmin {
  condition?: FieldCondition
  description?: string
}

export interface ClientTab {
  label: string
  description?: string
  admin?: ClientTabAdmin
  condition?: FieldCondition
  fields: ClientField[]
}

export interface ClientTabsFieldAdmin {
  description?: string
}

export interface ClientRowFieldAdmin {
  description?: string
}

export interface ClientCollapsibleFieldAdmin {
  description?: string
}

export interface ClientTabsField extends ClientFieldBase {
  type: 'tabs'
  admin?: ClientTabsFieldAdmin
  tabs: ClientTab[]
}

export interface ClientRowField extends ClientFieldBase {
  type: 'row'
  admin?: ClientRowFieldAdmin
  fields: ClientField[]
}

export interface ClientCollapsibleField extends ClientFieldBase {
  type: 'collapsible'
  initiallyCollapsed?: boolean
  admin?: ClientCollapsibleFieldAdmin
  fields: ClientField[]
}

export type ClientField =
  | ClientTextField
  | ClientNumberField
  | ClientTextareaField
  | ClientCodeField
  | ClientJsonField
  | ClientEmailField
  | ClientSlugField
  | ClientCheckboxField
  | ClientSelectField
  | ClientRadioField
  | ClientPointField
  | ClientDateField
  | ClientRichTextField
  | ClientRelationshipField
  | ClientUploadField
  | ClientGroupField
  | ClientArrayField
  | ClientBlocksField
  | ClientTabsField
  | ClientRowField
  | ClientCollapsibleField
