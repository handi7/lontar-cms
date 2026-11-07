import { useState, useEffect } from 'react'
import { Controller } from 'react-hook-form'
import type { Control, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type {
  ClientCheckboxField,
  ClientDateField,
  ClientEmailField,
  ClientField,
  ClientNumberField,
  ClientRichTextField,
  ClientSelectField,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
} from '@lontar/core/client'
import { Field, FieldError, FieldLabel } from '../components/ui/field'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { DateTimePicker } from './DateTimePicker'
import { RichTextEditor } from './RichTextEditor'
import { RelationshipPicker } from './RelationshipPicker'
import { UploadPicker } from './UploadPicker'

export interface FieldRendererProps {
  field: ClientField
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  error?: { message?: string }
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
}

/**
 * The attributes that tie a control to its label and error text. Passed down
 * rather than derived per input so every field type is wired the same way.
 */
interface FieldA11y {
  describedBy?: string
  invalid: boolean
  required: boolean
}

function a11yProps({ describedBy, invalid, required }: FieldA11y) {
  return {
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
    'aria-required': required || undefined,
  }
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

/**
 * `computeDefaultValues` omits keys for fields with no default, so a controlled
 * input would receive `undefined` and React would log the uncontrolled-to-
 * controlled warning on the first keystroke.
 */
function asInputValue(value: unknown): string | number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return value
  // Anything else (null, undefined, or a shape that does not belong in a text
  // input) renders empty rather than as '[object Object]'.
  return ''
}

interface ControlledProps<T extends ClientField> {
  field: T
  control: Control<Record<string, unknown>>
  a11y: FieldA11y
}

function TextFieldInput({ field, control, a11y }: ControlledProps<ClientTextField>) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: controlled }) => (
        <Input
          id={field.name}
          type="text"
          minLength={field.minLength}
          maxLength={field.maxLength}
          {...a11yProps(a11y)}
          {...controlled}
          value={asInputValue(controlled.value)}
        />
      )}
    />
  )
}

function NumberFieldInput({ field, control, a11y }: ControlledProps<ClientNumberField>) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: controlled }) => (
        <Input
          id={field.name}
          type="number"
          step={field.integer ? '1' : 'any'}
          min={field.min}
          max={field.max}
          {...a11yProps(a11y)}
          {...controlled}
          value={asInputValue(controlled.value)}
          // `setValueAs` has no Controller equivalent, so the only numeric
          // coercion in the package lives here now. It must keep producing
          // null rather than '' or NaN: nothing downstream re-coerces numbers.
          onChange={(event) => controlled.onChange(parseNumberValue(event.target.value))}
        />
      )}
    />
  )
}

function TextareaFieldInput({ field, control, a11y }: ControlledProps<ClientTextareaField>) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: controlled }) => (
        <Textarea
          id={field.name}
          rows={field.rows ?? 4}
          minLength={field.minLength}
          maxLength={field.maxLength}
          {...a11yProps(a11y)}
          {...controlled}
          value={asInputValue(controlled.value)}
        />
      )}
    />
  )
}

function EmailFieldInput({ field, control, a11y }: ControlledProps<ClientEmailField>) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: controlled }) => (
        <Input
          id={field.name}
          type="email"
          maxLength={field.maxLength}
          {...a11yProps(a11y)}
          {...controlled}
          value={asInputValue(controlled.value)}
        />
      )}
    />
  )
}

function CheckboxFieldInput({
  field,
  control,
  a11y,
}: {
  field: ClientCheckboxField
  control: Control<Record<string, unknown>>
  a11y: FieldA11y
}) {
  // `defaultValue={false}` matches what react-hook-form read from the native
  // checkbox this replaced when the form had no default. A stored null is left
  // as null until the box is clicked, as the native one did, and renders
  // unchecked: Radix's 'indeterminate' is never shown or submitted.
  return (
    <Controller
      control={control}
      name={field.name}
      defaultValue={false}
      render={({ field: controlled }) => (
        <div className="lt:flex lt:items-center lt:gap-2 lt:py-1">
          <Checkbox
            id={field.name}
            ref={controlled.ref}
            checked={controlled.value === true}
            onCheckedChange={(checked) => controlled.onChange(checked === true)}
            onBlur={controlled.onBlur}
            disabled={controlled.disabled}
            {...a11yProps(a11y)}
          />
          <Label htmlFor={field.name} className="lt:cursor-pointer lt:select-none">
            <span>{field.label}</span>
            {field.required && <span className="lontar-required">*</span>}
          </Label>
        </div>
      )}
    />
  )
}

// Radix forbids an item whose value is '', which is exactly what an optional
// select stores when nothing is chosen. The "-- Select --" item carries this
// stand-in instead, and it is translated back to '' on the way into the form.
const EMPTY_SELECT_VALUE = '__lontar_empty__'

function SelectFieldInput({
  field,
  control,
  a11y,
}: {
  field: ClientSelectField
  control: Control<Record<string, unknown>>
  a11y: FieldA11y
}) {
  // The native <select> this replaced was bound with `register`, so
  // react-hook-form read its DOM value as the initial one: the first option for
  // a required select, '' for an optional one (whose first option is the empty
  // one). A Radix Select has no DOM value to read, so the same initial value is
  // stated here. It only applies when the form has no default of its own.
  const initialValue = field.required ? (field.options[0]?.value ?? '') : ''

  return (
    <Controller
      control={control}
      name={field.name}
      defaultValue={initialValue}
      render={({ field: controlled }) => {
        const current = typeof controlled.value === 'string' ? controlled.value : ''
        return (
          <Select
            value={current === '' && !field.required ? EMPTY_SELECT_VALUE : current}
            onValueChange={(next) => {
              controlled.onChange(next === EMPTY_SELECT_VALUE ? '' : next)
            }}
            disabled={controlled.disabled}
          >
            <SelectTrigger
              id={field.name}
              ref={controlled.ref}
              onBlur={controlled.onBlur}
              {...a11yProps(a11y)}
            >
              <SelectValue placeholder="-- Select --" />
            </SelectTrigger>
            <SelectContent>
              {!field.required && <SelectItem value={EMPTY_SELECT_VALUE}>-- Select --</SelectItem>}
              {field.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }}
    />
  )
}

function DateFieldInput({
  field,
  control,
  a11y,
}: {
  field: ClientDateField
  control: Control<Record<string, unknown>>
  a11y: FieldA11y
}) {
  // The form holds the same local datetime string the native
  // <input type="datetime-local"> did (formatDateForInput in, formatDateForSubmit
  // out; ADR 0010). `defaultValue=''` matches what react-hook-form read from
  // that empty input when the form had no default.
  return (
    <Controller
      control={control}
      name={field.name}
      defaultValue=""
      render={({ field: controlled }) => (
        <DateTimePicker
          id={field.name}
          ref={controlled.ref}
          value={typeof controlled.value === 'string' ? controlled.value : ''}
          onChange={controlled.onChange}
          onBlur={controlled.onBlur}
          disabled={controlled.disabled}
          clearable={!field.required}
          {...a11yProps(a11y)}
        />
      )}
    />
  )
}

function SlugFieldInput({
  field,
  control,
  setValue,
  watch,
  mode,
  a11y,
}: ControlledProps<ClientSlugField> & {
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

  return (
    <div className="lontar-slug-wrapper">
      <Controller
        control={control}
        name={field.name}
        render={({ field: controlled }) => (
          <Input
            id={field.name}
            type="text"
            maxLength={field.maxLength}
            {...a11yProps(a11y)}
            {...controlled}
            value={asInputValue(controlled.value)}
            onChange={(event) => {
              setIsCustomized(true)
              controlled.onChange(event)
            }}
          />
        )}
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

function RichTextFieldInput({
  field,
  register,
  setValue,
  watch,
}: {
  field: ClientRichTextField
  register: UseFormRegister<Record<string, unknown>>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
}) {
  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const value = watch ? (watch(field.name) as Record<string, unknown> | undefined) : undefined

  return (
    <RichTextEditor
      name={field.name}
      value={value}
      onChange={(newVal) => {
        setValue?.(field.name, newVal, { shouldValidate: true, shouldDirty: true })
      }}
    />
  )
}

// Every standard field type is bound through Controller now; `register` is
// only still used by the fields that enroll a value without spreading it onto
// an element (richText, relationship, upload).
function StandardFieldInput({
  field,
  control,
  a11y,
}: {
  field: ClientField
  control: Control<Record<string, unknown>>
  a11y: FieldA11y
}) {
  switch (field.type) {
    case 'text':
      return <TextFieldInput field={field} control={control} a11y={a11y} />
    case 'number':
      return <NumberFieldInput field={field} control={control} a11y={a11y} />
    case 'textarea':
      return <TextareaFieldInput field={field} control={control} a11y={a11y} />
    case 'email':
      return <EmailFieldInput field={field} control={control} a11y={a11y} />
    case 'checkbox':
      return <CheckboxFieldInput field={field} control={control} a11y={a11y} />
    case 'select':
      return <SelectFieldInput field={field} control={control} a11y={a11y} />
    case 'date':
      return <DateFieldInput field={field} control={control} a11y={a11y} />
    default:
      return null
  }
}

function FieldInput({
  field,
  control,
  register,
  setValue,
  watch,
  mode,
  a11y,
}: {
  field: ClientField
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
  a11y: FieldA11y
}) {
  if (field.type === 'slug') {
    return (
      <SlugFieldInput
        field={field}
        control={control}
        setValue={setValue}
        watch={watch}
        mode={mode}
        a11y={a11y}
      />
    )
  }
  if (field.type === 'richText') {
    return (
      <RichTextFieldInput field={field} register={register} setValue={setValue} watch={watch} />
    )
  }
  if (field.type === 'relationship') {
    return (
      <RelationshipPicker field={field} register={register} setValue={setValue} watch={watch} />
    )
  }
  if (field.type === 'upload') {
    return <UploadPicker field={field} register={register} setValue={setValue} watch={watch} />
  }
  return <StandardFieldInput field={field} control={control} a11y={a11y} />
}

export function FieldRenderer({
  field,
  control,
  register,
  error,
  setValue,
  watch,
  mode,
}: FieldRendererProps) {
  const errorId = `${field.name}-error`
  const hasError = Boolean(error?.message)
  const a11y: FieldA11y = {
    describedBy: hasError ? errorId : undefined,
    invalid: hasError,
    required: field.required,
  }

  return (
    <Field className="lontar-field-group" data-invalid={hasError || undefined}>
      {field.type !== 'checkbox' && (
        <FieldLabel htmlFor={field.name} className="lontar-label">
          <span>{field.label}</span>
          {field.required && <span className="lontar-required">*</span>}
        </FieldLabel>
      )}
      <FieldInput
        field={field}
        control={control}
        register={register}
        setValue={setValue}
        watch={watch}
        mode={mode}
        a11y={a11y}
      />
      <FieldError
        id={errorId}
        className="lontar-field-error"
        errors={error ? [error] : undefined}
      />
    </Field>
  )
}
