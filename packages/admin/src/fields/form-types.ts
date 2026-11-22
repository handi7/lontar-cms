import type { Control, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { ClientField } from '@lontar/core/client'

/** What every document form holds. Change it here and every field input follows. */
export type FormValues = Record<string, unknown>

export type FormControl = Control<FormValues>
export type FormRegister = UseFormRegister<FormValues>
export type FormSetValue = UseFormSetValue<FormValues>
export type FormWatch = UseFormWatch<FormValues>

/**
 * The attributes that tie a control to its label and error text. Passed down
 * rather than derived per input so every field type is wired the same way.
 */
export interface FieldA11y {
  describedBy?: string
  invalid: boolean
  required: boolean
}

/** The props of an input bound through `Controller`. */
export interface ControlledFieldProps<F extends ClientField> {
  field: F
  control: FormControl
  a11y: FieldA11y
  disabled?: boolean
}
