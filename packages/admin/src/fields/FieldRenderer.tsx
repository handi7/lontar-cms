import { useState, useEffect } from 'react'
import { Controller, useFieldArray, useWatch } from 'react-hook-form'
import type { Control, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import {
  generateRowId,
  getValueByPath,
  matchesCondition,
  type FieldCondition,
  type ClientArrayField,
  type ClientBlock,
  type ClientBlocksField,
  type ClientCheckboxField,
  type ClientDateField,
  type ClientEmailField,
  type ClientField,
  type ClientGroupField,
  type ClientNumberField,
  type ClientRichTextField,
  type ClientSelectField,
  type ClientSlugField,
  type ClientTextareaField,
  type ClientTextField,
} from '@lontar/core/client'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { computeDefaultValues } from '../utils/form-utils'
import { Field, FieldError, FieldLabel } from '../components/ui/field'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
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
  error?: { message?: string } | Record<string, unknown>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
  pathPrefix?: string
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

interface GroupFieldRendererProps {
  field: ClientGroupField
  fullName: string
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  error?: { message?: string } | Record<string, unknown>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
}

function GroupFieldRenderer({
  field,
  fullName,
  control,
  register,
  error,
  setValue,
  watch,
  mode,
}: GroupFieldRendererProps) {
  return (
    <fieldset
      className="lontar-field-group lt:rounded-lg lt:border lt:border-[var(--lontar-border)] lt:p-4 lt:flex lt:flex-col lt:gap-4"
      data-group={fullName}
    >
      <legend className="lt:text-sm lt:font-semibold lt:text-[var(--lontar-text)] lt:px-1">
        <span>{field.label}</span>
        {field.required && (
          <span className="lontar-required lt:ml-1 lt:text-[var(--lontar-destructive)]">*</span>
        )}
      </legend>
      {field.fields.map((subField) => {
        const subError =
          error && typeof error === 'object' && Object.hasOwn(error, subField.name)
            ? (error as Record<string, unknown>)[subField.name]
            : undefined
        return (
          <FieldRenderer
            key={subField.name}
            field={subField}
            control={control}
            register={register}
            setValue={setValue}
            watch={watch}
            mode={mode}
            pathPrefix={fullName}
            error={subError as { message?: string } | undefined}
          />
        )
      })}
    </fieldset>
  )
}

function getErrorMessage(
  error?: { message?: string } | Record<string, unknown>,
): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('message' in error && typeof error.message === 'string') {
    return error.message
  }
  if ('root' in error && error.root && typeof error.root === 'object' && 'message' in error.root) {
    return (error.root as { message?: string }).message
  }
  return undefined
}

interface ArrayFieldRendererProps {
  field: ClientArrayField
  fullName: string
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  error?: { message?: string } | Record<string, unknown>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
}

interface ArrayRowRendererProps {
  field: ClientArrayField
  index: number
  totalRows: number
  minRows: number
  maxRows: number
  rowPath: string
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  rowError?: Record<string, unknown>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  onDuplicate: () => void
}

function getRowLabelFromSubfields(
  field: ClientArrayField,
  rowPath: string,
  watch?: UseFormWatch<Record<string, unknown>>,
): string | undefined {
  if (!watch) return undefined

  if (field.admin?.rowLabel) {
    const val: unknown = watch(`${rowPath}.${field.admin.rowLabel}` as never)
    if (typeof val === 'string' && val.trim().length > 0) {
      return val
    }
  }

  const firstTextField = field.fields.find(
    (f) => f.type === 'text' || f.type === 'slug' || f.type === 'email',
  )
  if (firstTextField) {
    const val: unknown = watch(`${rowPath}.${firstTextField.name}` as never)
    if (typeof val === 'string' && val.trim().length > 0) {
      return val
    }
  }

  return undefined
}

function getRowLabel(
  field: ClientArrayField,
  index: number,
  rowPath: string,
  watch?: UseFormWatch<Record<string, unknown>>,
): string {
  const custom = getRowLabelFromSubfields(field, rowPath, watch)
  if (custom) return custom
  const singular = field.labels?.singular || field.label || 'Row'
  return `${singular} #${index + 1}`
}

function ArrayRowRenderer({
  field,
  index,
  totalRows,
  minRows,
  maxRows,
  rowPath,
  control,
  register,
  rowError,
  setValue,
  watch,
  mode,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDuplicate,
}: ArrayRowRendererProps) {
  const [collapsed, setCollapsed] = useState(false)
  const label = getRowLabel(field, index, rowPath, watch)

  return (
    <div
      className="lontar-array-row lt:rounded-md lt:border lt:border-[var(--lontar-border)] lt:bg-[var(--lontar-card)] lt:overflow-hidden"
      data-array-row={index}
    >
      <div className="lt:flex lt:items-center lt:justify-between lt:gap-2 lt:px-3 lt:py-2 lt:bg-[var(--lontar-muted)]/50 lt:border-b lt:border-[var(--lontar-border)]">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="lt:flex lt:items-center lt:gap-2 lt:text-sm lt:font-medium lt:text-[var(--lontar-text)] lt:hover:text-[var(--lontar-text-primary)] lt:focus-visible:outline-none lt:cursor-pointer"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          {collapsed ? (
            <ChevronRight className="lt:size-4 lt:text-[var(--lontar-muted-foreground)]" />
          ) : (
            <ChevronDown className="lt:size-4 lt:text-[var(--lontar-muted-foreground)]" />
          )}
          <span>{label}</span>
        </button>

        <div className="lt:flex lt:items-center lt:gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation()
              onMoveUp()
            }}
            aria-label="Move row up"
            title="Move row up"
          >
            <ArrowUp className="lt:size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7"
            disabled={index === totalRows - 1}
            onClick={(e) => {
              e.stopPropagation()
              onMoveDown()
            }}
            aria-label="Move row down"
            title="Move row down"
          >
            <ArrowDown className="lt:size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7"
            disabled={totalRows >= maxRows}
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            aria-label="Duplicate row"
            title="Duplicate row"
          >
            <Copy className="lt:size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7 lt:text-[var(--lontar-destructive)] lt:hover:bg-[var(--lontar-destructive)]/10"
            disabled={totalRows <= minRows}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label="Remove row"
            title="Remove row"
          >
            <Trash2 className="lt:size-3.5" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="lt:p-4 lt:flex lt:flex-col lt:gap-4">
          {field.fields.map((subField) => {
            const subError =
              rowError && typeof rowError === 'object' && Object.hasOwn(rowError, subField.name)
                ? rowError[subField.name]
                : undefined
            return (
              <FieldRenderer
                key={subField.name}
                field={subField}
                control={control}
                register={register}
                setValue={setValue}
                watch={watch}
                mode={mode}
                pathPrefix={rowPath}
                error={subError as { message?: string } | undefined}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ArrayHeader({
  label,
  required,
  description,
  rowCount,
  maxRows,
  hasBounds,
}: {
  label: string
  required: boolean
  description?: string
  rowCount: number
  maxRows: number
  hasBounds: boolean
}) {
  return (
    <div className="lt:flex lt:items-center lt:justify-between lt:gap-2">
      <div>
        <legend className="lt:text-sm lt:font-semibold lt:text-[var(--lontar-text)] lt:px-1">
          <span>{label}</span>
          {required && (
            <span className="lontar-required lt:ml-1 lt:text-[var(--lontar-destructive)]">*</span>
          )}
        </legend>
        {description && (
          <p className="lt:text-xs lt:text-[var(--lontar-muted-foreground)] lt:px-1 lt:mt-0.5">
            {description}
          </p>
        )}
      </div>
      {hasBounds && (
        <span className="lt:text-xs lt:text-[var(--lontar-muted-foreground)]">
          {rowCount} / {maxRows}
        </span>
      )}
    </div>
  )
}

function getRowError(
  error: { message?: string } | Record<string, unknown> | undefined,
  index: number,
): Record<string, unknown> | undefined {
  if (!error || typeof error !== 'object') return undefined
  if (Array.isArray(error)) {
    return error[index] as Record<string, unknown> | undefined
  }
  return (error as Record<string, unknown>)[index] as Record<string, unknown> | undefined
}

function ArrayFieldRenderer({
  field,
  fullName,
  control,
  register,
  error,
  setValue,
  watch,
  mode,
}: ArrayFieldRendererProps) {
  const { fields, append, remove, move, insert } = useFieldArray({
    control,
    name: fullName as never,
  })

  const minRows = field.minRows ?? (field.required ? 1 : 0)
  const maxRows = field.maxRows ?? 100
  const singular = field.labels?.singular || field.label || 'Row'
  const rootErrorMessage = getErrorMessage(error)
  const hasBounds = field.minRows !== undefined || field.maxRows !== undefined

  return (
    <fieldset
      className="lontar-field-array lt:rounded-lg lt:border lt:border-[var(--lontar-border)] lt:p-4 lt:flex lt:flex-col lt:gap-4"
      data-array={fullName}
    >
      <ArrayHeader
        label={field.label}
        required={field.required}
        description={field.admin?.description}
        rowCount={fields.length}
        maxRows={maxRows}
        hasBounds={hasBounds}
      />

      {rootErrorMessage && (
        <FieldError className="lontar-field-error" errors={[{ message: rootErrorMessage }]} />
      )}

      <div className="lt:flex lt:flex-col lt:gap-3">
        {fields.map((item, index) => {
          const rowPath = `${fullName}.${index}`
          const rowError = getRowError(error, index)

          return (
            <ArrayRowRenderer
              key={item.id}
              field={field}
              index={index}
              totalRows={fields.length}
              minRows={minRows}
              maxRows={maxRows}
              rowPath={rowPath}
              control={control}
              register={register}
              rowError={rowError}
              setValue={setValue}
              watch={watch}
              mode={mode}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              onRemove={() => remove(index)}
              onDuplicate={() => {
                const currentData: unknown = watch ? watch(rowPath as never) : undefined
                const cloned =
                  currentData && typeof currentData === 'object'
                    ? { ...(currentData as Record<string, unknown>) }
                    : computeDefaultValues(field.fields)
                cloned.id = generateRowId()
                insert(index + 1, cloned)
              }}
            />
          )
        })}
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= maxRows}
          onClick={() => {
            const defaults = computeDefaultValues(field.fields)
            append({ ...defaults, id: generateRowId() })
          }}
          className="lt:flex lt:items-center lt:gap-1.5"
        >
          <Plus className="lt:size-4" />
          <span>Add {singular}</span>
        </Button>
      </div>
    </fieldset>
  )
}

interface BlockRowRendererProps {
  block: ClientBlock
  index: number
  totalRows: number
  minRows: number
  maxRows: number
  rowPath: string
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  rowError?: Record<string, unknown>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  onDuplicate: () => void
}

function getBlockRowLabel(
  block: ClientBlock,
  index: number,
  rowPath: string,
  watch?: UseFormWatch<Record<string, unknown>>,
): string {
  const blockTitle = block.labels?.singular || block.slug
  if (watch) {
    const firstTextField = block.fields.find(
      (f) => f.type === 'text' || f.type === 'slug' || f.type === 'email',
    )
    if (firstTextField) {
      const val: unknown = watch(`${rowPath}.${firstTextField.name}` as never)
      if (typeof val === 'string' && val.trim().length > 0) {
        return `${blockTitle} - ${val.trim()}`
      }
    }
  }
  return `${blockTitle} #${index + 1}`
}

function BlockRowRenderer({
  block,
  index,
  totalRows,
  minRows,
  maxRows,
  rowPath,
  control,
  register,
  rowError,
  setValue,
  watch,
  mode,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDuplicate,
}: BlockRowRendererProps) {
  const [collapsed, setCollapsed] = useState(false)
  const label = getBlockRowLabel(block, index, rowPath, watch)

  useEffect(() => {
    register(`${rowPath}.blockType` as never)
  }, [register, rowPath])

  return (
    <div
      className="lontar-block-row lt:rounded-md lt:border lt:border-[var(--lontar-border)] lt:bg-[var(--lontar-card)] lt:overflow-hidden"
      data-block-row={index}
      data-block-type={block.slug}
    >
      <div className="lt:flex lt:items-center lt:justify-between lt:gap-2 lt:px-3 lt:py-2 lt:bg-[var(--lontar-muted)]/50 lt:border-b lt:border-[var(--lontar-border)]">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="lt:flex lt:items-center lt:gap-2 lt:text-sm lt:font-medium lt:text-[var(--lontar-text)] lt:hover:text-[var(--lontar-text-primary)] lt:focus-visible:outline-none lt:cursor-pointer"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          {collapsed ? (
            <ChevronRight className="lt:size-4 lt:text-[var(--lontar-muted-foreground)]" />
          ) : (
            <ChevronDown className="lt:size-4 lt:text-[var(--lontar-muted-foreground)]" />
          )}
          <span>{label}</span>
        </button>

        <div className="lt:flex lt:items-center lt:gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation()
              onMoveUp()
            }}
            aria-label="Move block up"
            title="Move block up"
          >
            <ArrowUp className="lt:size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7"
            disabled={index === totalRows - 1}
            onClick={(e) => {
              e.stopPropagation()
              onMoveDown()
            }}
            aria-label="Move block down"
            title="Move block down"
          >
            <ArrowDown className="lt:size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7"
            disabled={totalRows >= maxRows}
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            aria-label="Duplicate block"
            title="Duplicate block"
          >
            <Copy className="lt:size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7 lt:text-[var(--lontar-destructive)] lt:hover:bg-[var(--lontar-destructive)]/10"
            disabled={totalRows <= minRows}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label="Remove block"
            title="Remove block"
          >
            <Trash2 className="lt:size-3.5" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="lt:p-4 lt:flex lt:flex-col lt:gap-4">
          <input type="hidden" value={block.slug} {...register(`${rowPath}.blockType` as never)} />
          {block.fields.map((subField) => {
            const subError =
              rowError && typeof rowError === 'object' && Object.hasOwn(rowError, subField.name)
                ? rowError[subField.name]
                : undefined
            return (
              <FieldRenderer
                key={subField.name}
                field={subField}
                control={control}
                register={register}
                setValue={setValue}
                watch={watch}
                mode={mode}
                pathPrefix={rowPath}
                error={subError as { message?: string } | undefined}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function AddBlockPicker({
  blocks,
  disabled,
  onSelectBlock,
}: {
  blocks: readonly ClientBlock[]
  disabled: boolean
  onSelectBlock: (block: ClientBlock) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="lt:flex lt:items-center lt:gap-1.5"
          aria-label="Add block"
        >
          <Plus className="lt:size-4" />
          <span>Add Block</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="lt:w-56 lt:p-1 lt:flex lt:flex-col lt:gap-0.5" align="start">
        {blocks.map((block) => (
          <button
            key={block.slug}
            type="button"
            className="lt:w-full lt:flex lt:items-center lt:justify-between lt:px-3 lt:py-2 lt:text-sm lt:rounded-sm lt:hover:bg-[var(--lontar-accent)] lt:text-left lt:cursor-pointer lt:text-[var(--lontar-text)]"
            onClick={() => {
              onSelectBlock(block)
              setOpen(false)
            }}
          >
            <span>{block.labels?.singular || block.slug}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

interface BlocksFieldRendererProps {
  field: ClientBlocksField
  fullName: string
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  error?: { message?: string } | Record<string, unknown>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
}

function BlocksFieldRenderer({
  field,
  fullName,
  control,
  register,
  error,
  setValue,
  watch,
  mode,
}: BlocksFieldRendererProps) {
  const { fields, append, remove, move, insert } = useFieldArray({
    control,
    name: fullName as never,
  })

  const minRows = field.minRows ?? (field.required ? 1 : 0)
  const maxRows = field.maxRows ?? 100
  const rootErrorMessage = getErrorMessage(error)
  const hasBounds = field.minRows !== undefined || field.maxRows !== undefined

  return (
    <fieldset
      className="lontar-field-blocks lt:rounded-lg lt:border lt:border-[var(--lontar-border)] lt:p-4 lt:flex lt:flex-col lt:gap-4"
      data-blocks={fullName}
    >
      <ArrayHeader
        label={field.label}
        required={field.required}
        description={field.admin?.description}
        rowCount={fields.length}
        maxRows={maxRows}
        hasBounds={hasBounds}
      />

      {rootErrorMessage && (
        <FieldError className="lontar-field-error" errors={[{ message: rootErrorMessage }]} />
      )}

      <div className="lt:flex lt:flex-col lt:gap-3">
        {fields.map((item, index) => {
          const rowPath = `${fullName}.${index}`
          const rowError = getRowError(error, index)
          const watchedType = watch
            ? (watch(`${rowPath}.blockType` as never) as unknown as string | undefined)
            : undefined
          const itemType = (item as { blockType?: string }).blockType
          const blockType = watchedType || itemType
          const blockDef = field.blocks.find((b) => b.slug === blockType) || field.blocks[0]

          if (!blockDef) return null

          return (
            <BlockRowRenderer
              key={item.id}
              block={blockDef}
              index={index}
              totalRows={fields.length}
              minRows={minRows}
              maxRows={maxRows}
              rowPath={rowPath}
              control={control}
              register={register}
              rowError={rowError}
              setValue={setValue}
              watch={watch}
              mode={mode}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              onRemove={() => remove(index)}
              onDuplicate={() => {
                const currentData: unknown = watch ? watch(rowPath as never) : undefined
                const cloned: Record<string, unknown> =
                  currentData && typeof currentData === 'object'
                    ? { ...(currentData as Record<string, unknown>) }
                    : { ...computeDefaultValues(blockDef.fields), blockType: blockDef.slug }
                cloned.id = generateRowId()
                insert(index + 1, cloned)
              }}
            />
          )
        })}
      </div>

      <div>
        <AddBlockPicker
          blocks={field.blocks}
          disabled={fields.length >= maxRows}
          onSelectBlock={(block) => {
            const defaults = computeDefaultValues(block.fields)
            append({ ...defaults, id: generateRowId(), blockType: block.slug })
          }}
        />
      </div>
    </fieldset>
  )
}

interface StandardFieldRendererProps {
  field: ClientField
  fullName: string
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  errorMessage?: string
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
  mode?: 'create' | 'edit'
}

function StandardFieldRenderer({
  field,
  fullName,
  control,
  register,
  errorMessage,
  setValue,
  watch,
  mode,
}: StandardFieldRendererProps) {
  const errorId = `${fullName}-error`
  const hasError = Boolean(errorMessage)
  const a11y: FieldA11y = {
    describedBy: hasError ? errorId : undefined,
    invalid: hasError,
    required: field.required,
  }

  return (
    <Field className="lontar-field-group" data-invalid={hasError || undefined}>
      {field.type !== 'checkbox' && (
        <FieldLabel htmlFor={fullName} className="lontar-label">
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
        errors={errorMessage ? [{ message: errorMessage }] : undefined}
      />
    </Field>
  )
}

function UnconditionalFieldRenderer({
  field,
  control,
  register,
  error,
  setValue,
  watch,
  mode,
  pathPrefix,
}: FieldRendererProps) {
  const fullName = pathPrefix ? `${pathPrefix}.${field.name}` : field.name

  if (field.type === 'group') {
    return (
      <GroupFieldRenderer
        field={field}
        fullName={fullName}
        control={control}
        register={register}
        error={error}
        setValue={setValue}
        watch={watch}
        mode={mode}
      />
    )
  }

  if (field.type === 'array') {
    return (
      <ArrayFieldRenderer
        field={field}
        fullName={fullName}
        control={control}
        register={register}
        error={error}
        setValue={setValue}
        watch={watch}
        mode={mode}
      />
    )
  }

  if (field.type === 'blocks') {
    return (
      <BlocksFieldRenderer
        field={field}
        fullName={fullName}
        control={control}
        register={register}
        error={error}
        setValue={setValue}
        watch={watch}
        mode={mode}
      />
    )
  }

  const boundField = pathPrefix ? { ...field, name: fullName } : field
  const errorMessage = getErrorMessage(error)

  return (
    <StandardFieldRenderer
      field={boundField}
      fullName={fullName}
      control={control}
      register={register}
      errorMessage={errorMessage}
      setValue={setValue}
      watch={watch}
      mode={mode}
    />
  )
}

function ConditionalFieldRenderer(props: FieldRendererProps & { condition: FieldCondition }) {
  const watchedValues = useWatch<Record<string, unknown>>({ control: props.control })
  const rootValues = watchedValues ?? (props.watch ? props.watch() : {})

  const siblingData = props.pathPrefix
    ? (getValueByPath(rootValues, props.pathPrefix) as Record<string, unknown> | undefined)
    : rootValues

  const isVisible = matchesCondition(props.condition, rootValues, siblingData)
  if (!isVisible) {
    return null
  }

  return <UnconditionalFieldRenderer {...props} />
}

export function FieldRenderer(props: FieldRendererProps) {
  if (props.field.condition) {
    return <ConditionalFieldRenderer {...props} condition={props.field.condition} />
  }
  return <UnconditionalFieldRenderer {...props} />
}
