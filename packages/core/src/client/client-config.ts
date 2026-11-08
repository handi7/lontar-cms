/** Bumped whenever the shape below changes incompatibly. */
export const CLIENT_CONFIG_VERSION = 2

/**
 * Everything the admin knows about the config, served as JSON from
 * `GET /api/_lontar/config`. Plain data only: it must survive
 * `JSON.parse(JSON.stringify(x))` unchanged. See docs/adr/0003-client-config-format.md.
 */
export interface ClientConfig {
  version: typeof CLIENT_CONFIG_VERSION
  collections: ClientCollection[]
  globals: ClientGlobal[]
}

export interface ClientGlobal {
  slug: string
  label: string
  /** In config order. System fields are not listed. */
  fields: ClientField[]
}

export interface ClientUploadConfig {
  mimeTypes?: string[]
  maxFileSize?: number
}

export interface ClientPaginationConfig {
  defaultLimit?: number
  maxLimit?: number
}

export interface ClientCollection {
  slug: string
  labels: { singular: string; plural: string }
  admin: { useAsTitle: string; defaultColumns: string[] }
  upload?: boolean | ClientUploadConfig
  pagination?: ClientPaginationConfig
  /** In config order. System fields are not listed: every document has them. */
  fields: ClientField[]
}

interface ClientFieldBase {
  name: string
  label: string
  required: boolean
}

export interface ClientTextField extends ClientFieldBase {
  type: 'text'
  minLength?: number
  maxLength?: number
  defaultValue?: string
}

export interface ClientNumberField extends ClientFieldBase {
  type: 'number'
  min?: number
  max?: number
  integer?: boolean
  defaultValue?: number
}

export interface ClientTextareaField extends ClientFieldBase {
  type: 'textarea'
  minLength?: number
  maxLength?: number
  rows?: number
  defaultValue?: string
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

export type ClientField =
  | ClientTextField
  | ClientNumberField
  | ClientTextareaField
  | ClientEmailField
  | ClientSlugField
  | ClientCheckboxField
  | ClientSelectField
  | ClientDateField
  | ClientRichTextField
  | ClientRelationshipField
  | ClientUploadField
  | ClientGroupField
  | ClientArrayField
  | ClientBlocksField
