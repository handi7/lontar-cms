/*
 * Field definitions are plain data (docs/adr/0003-client-config-format.md).
 * Anything that converts a field (to Zod, to a column, to a ClientField) lives
 * in a registry keyed by `type`, never on the field object itself.
 */

interface BaseField {
  /** Shown in the admin. Defaults to the field name, humanized. */
  label?: string
  required?: boolean
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

export type Field =
  | TextField
  | NumberField
  | TextareaField
  | EmailField
  | SlugField
  | CheckboxField
  | SelectField
  | DateField
export type FieldType = Field['type']
export type Fields = Record<string, Field>
