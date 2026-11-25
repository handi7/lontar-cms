import type { AuthUser } from '../auth/types'
import type { FieldCondition } from '../client/condition'

/*
 * Field definitions are plain data (docs/adr/0003-client-config-format.md).
 * Anything that converts a field (to Zod, to a column, to a ClientField) lives
 * in a registry keyed by `type`, never on the field object itself.
 */

export interface FieldAccessArgs<TData = unknown, TSiblingData = unknown, TDoc = unknown> {
  user: AuthUser | null
  id?: string | number
  data?: TData
  siblingData?: TSiblingData
  doc?: TDoc
  req?: Request
  locale?: string
}

export type FieldAccessFunction = (args: FieldAccessArgs) => boolean | Promise<boolean>

export interface FieldAccess {
  read?: FieldAccessFunction
  create?: FieldAccessFunction
  update?: FieldAccessFunction
}

/**
 * Keys of the components a host registers on `<Admin components>`. Empty so that projects can
 * declare theirs by merging (like `UserRoleExtension`), which makes a typo in
 * `admin.component` a compile error. Without a declaration any string is accepted.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- meant to be augmented by consumers via declaration merging
export interface AdminComponentKeys {}
export type AdminComponentKey = [keyof AdminComponentKeys] extends [never]
  ? string
  : Extract<keyof AdminComponentKeys, string>

export interface FieldAdminOptions {
  description?: string
  condition?: FieldCondition
  /**
   * Key of a component registered on `<Admin components>` that replaces this field's input. The
   * label, description, conditional display, access locks and validation stay Lontar's.
   * Not allowed on `group`, `array` and `blocks`, which render their nested fields.
   */
  component?: AdminComponentKey
}

export interface BaseField {
  /** Shown in the admin. Defaults to the field name, humanized. */
  label?: string
  required?: boolean
  /** Whether the field holds independent values per locale. Requires localization in config. */
  localized?: boolean
  admin?: FieldAdminOptions
  access?: FieldAccess
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

export interface CodeField extends BaseField {
  type: 'code'
  language?: string
  minLength?: number
  maxLength?: number
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

export type RadioLayout = 'horizontal' | 'vertical'

export interface RadioFieldOptions {
  label?: string
  required?: boolean
  options: readonly SelectOption[]
  layout?: RadioLayout
  defaultValue?: string
  admin?: FieldAdminOptions
  access?: FieldAccess
  localized?: boolean
}

export interface RadioField extends BaseField {
  type: 'radio'
  options: readonly SelectOption[]
  layout?: RadioLayout
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
  admin?: FieldAdminOptions
  access?: FieldAccess
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
  admin?: FieldAdminOptions
  access?: FieldAccess
}

export interface UploadField extends BaseField {
  type: 'upload'
  relationTo: string
}

export interface GroupFieldOptions {
  label?: string
  required?: boolean
  fields: Record<string, Field>
  admin?: FieldAdminOptions
  access?: FieldAccess
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
  access?: FieldAccess
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
  access?: FieldAccess
}

export interface BlocksField extends BaseField {
  type: 'blocks'
  blocks: readonly Block[]
  minRows?: number
  maxRows?: number
  labels?: { singular: string; plural: string }
  admin?: BlocksFieldAdminOptions
}

export type JsonValue =
  string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[]

export interface JsonField extends BaseField {
  type: 'json'
  maxBytes?: number
  defaultValue?: JsonValue
}

export interface PointField extends BaseField {
  type: 'point'
  defaultValue?: [number, number]
}

export type PointFieldOptions = Omit<PointField, 'type'>

export type Field =
  | TextField
  | NumberField
  | TextareaField
  | CodeField
  | JsonField
  | PointField
  | EmailField
  | SlugField
  | CheckboxField
  | SelectField
  | RadioField
  | DateField
  | RichTextField
  | RelationshipField
  | UploadField
  | GroupField
  | ArrayField
  | BlocksField
export type FieldType = Field['type']
export type Fields = Record<string, Field>
