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

export type Field = TextField | NumberField
export type FieldType = Field['type']
export type Fields = Record<string, Field>
