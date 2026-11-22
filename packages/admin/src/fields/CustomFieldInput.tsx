import { Controller } from 'react-hook-form'
import type { ClientField } from '@lontar/core/client'
import { CustomComponent } from '../components/CustomComponent'
import { useLocale } from '../hooks/useLocale'
import type { FormControl } from './form-types'

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

export interface CustomFieldInputProps {
  field: ClientField
  component: string
  fullName: string
  control: FormControl
  disabled?: boolean
  isLocked?: boolean
  errorMessage?: string
}

export function CustomFieldInput({
  field,
  component,
  fullName,
  control,
  disabled,
  isLocked,
  errorMessage,
}: CustomFieldInputProps) {
  const { activeLocale } = useLocale()
  return (
    <Controller
      control={control}
      name={fullName}
      render={({ field: controlled }) => {
        const props: CustomFieldProps = {
          value: controlled.value,
          onChange: controlled.onChange,
          onBlur: controlled.onBlur,
          path: fullName,
          // Nested fields arrive with their full path as `name`; hand over the field as declared.
          field: { ...field, name: fullName.split('.').pop() ?? field.name },
          readOnly: Boolean(disabled || isLocked || controlled.disabled),
          locale: activeLocale,
          error: errorMessage,
        }
        return <CustomComponent name={component} componentProps={props} />
      }}
    />
  )
}
