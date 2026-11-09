import type { FieldCondition } from '../client/condition'

/*
 * Field definitions are plain data (docs/adr/0003-client-config-format.md).
 * Anything that converts a field (to Zod, to a column, to a ClientField) lives
 * in a registry keyed by `type`, never on the field object itself.
 */

export interface FieldAdminOptions {
  description?: string
  condition?: FieldCondition
}

export interface BaseField {
  /** Shown in the admin. Defaults to the field name, humanized. */
  label?: string
  required?: boolean
  admin?: FieldAdminOptions
}

export interface TextField extends BaseField {
  type: 'text'
  minLength?: number
  maxLength?: number
  defaultValue?: string
}

export interface NumberField extends BaseField {
  type: 'number'
  min?: number
  max?: number
  /** Only whole numbers are valid, and the column is an integer type. */
  integer?: boolean
  defaultValue?: number
}

export interface TextareaField extends BaseField {
  type: 'textarea'
  minLength?: number
  maxLength?: number
  rows?: number
  defaultValue?: string
}

export interface EmailField extends BaseField {
  type: 'email'
  unique?: boolean
  defaultValue?: string
}

export interface SlugField extends BaseField {
  type: 'slug'
  /** The field name to generate the slug from (e.g. 'title') */
  from?: string
  unique?: boolean
  defaultValue?: string
}

export interface CheckboxField extends BaseField {
  type: 'checkbox'
  defaultValue?: boolean
}

export type SelectOption =
  | string
  | {
      label: string
      value: string
    }

export interface SelectField extends BaseField {
  type: 'select'
  options: readonly SelectOption[]
  defaultValue?: string
}

export interface DateField extends BaseField {
  type: 'date'
  defaultValue?: string
}

export interface RichTextField extends BaseField {
  type: 'richText'
  defaultValue?: Record<string, unknown>
}

export interface RelationshipFieldOptions {
  label?: string
  required?: boolean
  relationTo: string
  hasMany?: boolean
}

export interface RelationshipField extends BaseField {
  type: 'relationship'
  relationTo: string
  hasMany?: boolean
}

export interface UploadFieldOptions {
  label?: string
  required?: boolean
  relationTo: string
}

export interface UploadField extends BaseField {
  type: 'upload'
  relationTo: string
}

export interface GroupFieldOptions {
  label?: string
  required?: boolean
  fields: Record<string, Field>
}

export interface GroupField extends BaseField {
  type: 'group'
  fields: Record<string, Field>
}

export interface ArrayFieldAdminOptions extends FieldAdminOptions {
  rowLabel?: string
}

export interface ArrayFieldOptions {
  label?: string
  required?: boolean
  fields: Record<string, Field>
  minRows?: number
  maxRows?: number
  labels?: { singular: string; plural: string }
  admin?: ArrayFieldAdminOptions
}

export interface ArrayField extends BaseField {
  type: 'array'
  fields: Record<string, Field>
  minRows?: number
  maxRows?: number
  labels?: { singular: string; plural: string }
  admin?: ArrayFieldAdminOptions
}

export interface Block<
  TSlug extends string = string,
  TFields extends Record<string, Field> = Record<string, Field>,
> {
  slug: TSlug
  labels?: { singular: string; plural?: string }
  fields: TFields
}

export interface BlockConfig<
  TSlug extends string = string,
  TFields extends Record<string, Field> = Record<string, Field>,
> {
  slug: TSlug
  labels?: { singular: string; plural?: string }
  fields: TFields
}

export type BlocksFieldAdminOptions = FieldAdminOptions

export interface BlocksFieldOptions {
  label?: string
  required?: boolean
  blocks: readonly Block[]
  minRows?: number
  maxRows?: number
  labels?: { singular: string; plural: string }
  admin?: BlocksFieldAdminOptions
}

export interface BlocksField extends BaseField {
  type: 'blocks'
  blocks: readonly Block[]
  minRows?: number
  maxRows?: number
  labels?: { singular: string; plural: string }
  admin?: BlocksFieldAdminOptions
}

export type Field =
  | TextField
  | NumberField
  | TextareaField
  | EmailField
  | SlugField
  | CheckboxField
  | SelectField
  | DateField
  | RichTextField
  | RelationshipField
  | UploadField
  | GroupField
  | ArrayField
  | BlocksField
export type FieldType = Field['type']
export type Fields = Record<string, Field>
