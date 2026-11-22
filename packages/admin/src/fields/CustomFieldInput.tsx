import { Controller } from 'react-hook-form'
import type { ClientField } from '@lontar/core/client'
import { CustomComponent } from '../components/CustomComponent'
import { useLocale } from '../hooks/useLocale'
import type { CustomFieldProps } from './custom-field-props'
import type { FormControl } from './form-types'

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
