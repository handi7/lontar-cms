import type { UseFormRegister } from 'react-hook-form'
import type { ClientField, ClientNumberField, ClientTextField } from '@lontar/core/client'

export interface FieldRendererProps {
  field: ClientField
  register: UseFormRegister<Record<string, unknown>>
  error?: { message?: string }
}

function parseNumberValue(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) {
    return null
  }
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

function TextFieldInput({
  field,
  register,
}: {
  field: ClientTextField
  register: UseFormRegister<Record<string, unknown>>
}) {
  return (
    <input
      id={field.name}
      type="text"
      className="lontar-input"
      minLength={field.minLength}
      maxLength={field.maxLength}
      {...register(field.name)}
    />
  )
}

function NumberFieldInput({
  field,
  register,
}: {
  field: ClientNumberField
  register: UseFormRegister<Record<string, unknown>>
}) {
  return (
    <input
      id={field.name}
      type="number"
      className="lontar-input"
      step={field.integer ? '1' : 'any'}
      min={field.min}
      max={field.max}
      {...register(field.name, { setValueAs: parseNumberValue })}
    />
  )
}

export function FieldRenderer({ field, register, error }: FieldRendererProps) {
  return (
    <div className="lontar-field-group">
      <label htmlFor={field.name} className="lontar-label">
        <span>{field.label}</span>
        {field.required && <span className="lontar-required">*</span>}
      </label>
      {field.type === 'text' && <TextFieldInput field={field} register={register} />}
      {field.type === 'number' && <NumberFieldInput field={field} register={register} />}
      {error?.message && <span className="lontar-field-error">{error.message}</span>}
    </div>
  )
}
