import type { ClientField } from '@lontar/core/client'

/**
 * Props of a component registered for a field's `admin.component`. It replaces the input only:
 * the label, description, conditional display, access locks and validation stay Lontar's, and the
 * value is still checked by the field type's schema, so a component cannot change what is stored.
 */
export interface CustomFieldProps {
  /** The current value. `undefined` until the document has one. */
  value: unknown
  /** Sets this field's value. */
  onChange: (value: unknown) => void
  onBlur: () => void
  /** Full dotted path, e.g. `seo.score` or `rows.0.note`. */
  path: string
  field: ClientField
  /** True when the editor may not change the value: a field access lock, or a read-only document. */
  readOnly: boolean
  /** The locale being edited, when localization is on. */
  locale?: string
  /** The validation message, when the value is invalid. */
  error?: string
}
