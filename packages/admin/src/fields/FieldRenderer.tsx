import { useState, useEffect } from 'react'
import type { UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type {
  ClientEmailField,
  ClientField,
  ClientNumberField,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
} from '@lontar/core/client'

export interface FieldRendererProps {
  field: ClientField
  register: UseFormRegister<Record<string, unknown>>
  error?: { message?: string }
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

function TextareaFieldInput({
  field,
  register,
}: {
  field: ClientTextareaField
  register: UseFormRegister<Record<string, unknown>>
}) {
  return (
    <textarea
      id={field.name}
      className="lontar-input"
      rows={field.rows ?? 4}
      minLength={field.minLength}
      maxLength={field.maxLength}
      {...register(field.name)}
    />
  )
}

function EmailFieldInput({
  field,
  register,
}: {
  field: ClientEmailField
  register: UseFormRegister<Record<string, unknown>>
}) {
  return <input id={field.name} type="email" className="lontar-input" {...register(field.name)} />
}

function SlugFieldInput({
  field,
  register,
  setValue,
  watch,
  mode,
}: {
  field: ClientSlugField
  register: UseFormRegister<Record<string, unknown>>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
}) {
  const [isCustomized, setIsCustomized] = useState(mode === 'edit')
  const sourceValue = watch && field.from ? watch(field.from) : undefined

  useEffect(() => {
    if (
      !isCustomized &&
      mode !== 'edit' &&
      field.from &&
      typeof sourceValue === 'string' &&
      setValue
    ) {
      setValue(field.name, slugify(sourceValue), { shouldValidate: true })
    }
  }, [sourceValue, isCustomized, mode, field.from, field.name, setValue])

  const handleSync = () => {
    if (field.from && typeof sourceValue === 'string' && setValue) {
      setValue(field.name, slugify(sourceValue), { shouldValidate: true })
      setIsCustomized(false)
    }
  }

  const { onChange, ...restRegister } = register(field.name)

  return (
    <div className="lontar-slug-wrapper">
      <input
        id={field.name}
        type="text"
        className="lontar-input"
        {...restRegister}
        onChange={(e) => {
          setIsCustomized(true)
          void onChange(e)
        }}
      />
      {field.from && (
        <button
          type="button"
          className="lontar-btn lontar-btn-secondary lontar-slug-sync-btn"
          onClick={handleSync}
          title={`Sync from ${field.from}`}
        >
          Sync
        </button>
      )}
    </div>
  )
}

function FieldInput({
  field,
  register,
  setValue,
  watch,
  mode,
}: {
  field: ClientField
  register: UseFormRegister<Record<string, unknown>>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
}) {
  switch (field.type) {
    case 'text':
      return <TextFieldInput field={field} register={register} />
    case 'number':
      return <NumberFieldInput field={field} register={register} />
    case 'textarea':
      return <TextareaFieldInput field={field} register={register} />
    case 'email':
      return <EmailFieldInput field={field} register={register} />
    case 'slug':
      return (
        <SlugFieldInput
          field={field}
          register={register}
          setValue={setValue}
          watch={watch}
          mode={mode}
        />
      )
  }
}

export function FieldRenderer({
  field,
  register,
  error,
  setValue,
  watch,
  mode,
}: FieldRendererProps) {
  return (
    <div className="lontar-field-group">
      <label htmlFor={field.name} className="lontar-label">
        <span>{field.label}</span>
        {field.required && <span className="lontar-required">*</span>}
      </label>
      <FieldInput field={field} register={register} setValue={setValue} watch={watch} mode={mode} />
      {error?.message && <span className="lontar-field-error">{error.message}</span>}
    </div>
  )
}
