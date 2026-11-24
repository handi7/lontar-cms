import { useState, useEffect, useMemo } from 'react'
import type {
  ControlledFieldProps,
  FieldA11y,
  FormControl,
  FormRegister,
  FormSetValue,
  FormWatch,
} from './form-types'
import { Controller, useFieldArray, useWatch } from 'react-hook-form'
import {
  extractConditionPaths,
  generateRowId,
  getValueByPath,
  matchesCondition,
  setValueByPath,
  type FieldCondition,
  type ClientArrayField,
  type ClientBlock,
  type ClientBlocksField,
  type ClientCheckboxField,
  type ClientCodeField,
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
  type FieldPermission,
} from '@lontar/core/client'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { computeDefaultValues, isFieldReadOnly } from '../utils/form-utils'
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
import { CodeEditor } from '../components/CodeEditor'
import { DateTimePicker } from './DateTimePicker'
import { RichTextEditor } from './RichTextEditor'
import { RelationshipPicker } from './RelationshipPicker'
import { UploadPicker } from './UploadPicker'
import { CustomFieldInput } from './CustomFieldInput'

export interface FieldRendererProps {
  field: ClientField
  control: FormControl
  register: FormRegister
  error?: { message?: string } | Record<string, unknown>
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  pathPrefix?: string
  permissions?: FieldPermission
  disabled?: boolean
  readOnlyDoc?: boolean
  fallbackValue?: unknown
  hasLocalization?: boolean
  parentLocalized?: boolean
}

export interface FieldLocalizationBadgeProps {
  hasLocalization?: boolean
  isLocalized?: boolean
  fullName: string
}

export function FieldLocalizationBadge({
  hasLocalization,
  isLocalized,
  fullName,
}: FieldLocalizationBadgeProps) {
  if (!hasLocalization) return null
  if (isLocalized) {
    return (
      <Badge
        variant="outline"
        className="lt:text-[0.6875rem] lt:h-4 lt:px-1.5 lt:py-0 lt:font-normal lt:text-muted-foreground lt:ml-1"
        data-testid={`field-localized-${fullName}`}
      >
        Localized
      </Badge>
    )
  }
  return (
    <Badge
      variant="secondary"
      className="lt:text-[0.6875rem] lt:h-4 lt:px-1.5 lt:py-0 lt:font-normal lt:text-muted-foreground lt:ml-1"
      data-testid={`field-shared-${fullName}`}
    >
      Shared
    </Badge>
  )
}

function resolveFallbackPlaceholder(fallbackValue: unknown): string | undefined {
  if (typeof fallbackValue === 'string' && fallbackValue.trim() !== '') {
    return fallbackValue
  }
  if (typeof fallbackValue === 'number') {
    return String(fallbackValue)
  }
  return undefined
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

function TextFieldInput({
  field,
  control,
  a11y,
  disabled,
  placeholder,
}: ControlledFieldProps<ClientTextField> & { placeholder?: string }) {
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
          placeholder={placeholder}
          disabled={disabled || controlled.disabled}
          {...a11yProps(a11y)}
          {...controlled}
          value={asInputValue(controlled.value)}
        />
      )}
    />
  )
}

function NumberFieldInput({
  field,
  control,
  a11y,
  disabled,
  placeholder,
}: ControlledFieldProps<ClientNumberField> & { placeholder?: string }) {
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
          placeholder={placeholder}
          disabled={disabled || controlled.disabled}
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

function TextareaFieldInput({
  field,
  control,
  a11y,
  disabled,
  placeholder,
}: ControlledFieldProps<ClientTextareaField> & { placeholder?: string }) {
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
          placeholder={placeholder}
          disabled={disabled || controlled.disabled}
          {...a11yProps(a11y)}
          {...controlled}
          value={asInputValue(controlled.value)}
        />
      )}
    />
  )
}

export interface CodeFieldInputProps extends ControlledFieldProps<ClientCodeField> {
  placeholder?: string
}

function CodeFieldInput({ field, control, a11y, disabled, placeholder }: CodeFieldInputProps) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: controlled }) => (
        <CodeEditor
          id={field.name}
          language={field.language}
          minLength={field.minLength}
          maxLength={field.maxLength}
          placeholder={placeholder}
          disabled={disabled || controlled.disabled}
          {...a11yProps(a11y)}
          {...controlled}
          value={asInputValue(controlled.value)}
        />
      )}
    />
  )
}

function EmailFieldInput({
  field,
  control,
  a11y,
  disabled,
  placeholder,
}: ControlledFieldProps<ClientEmailField> & { placeholder?: string }) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: controlled }) => (
        <Input
          id={field.name}
          type="email"
          maxLength={field.maxLength}
          placeholder={placeholder}
          disabled={disabled || controlled.disabled}
          {...a11yProps(a11y)}
          {...controlled}
          value={asInputValue(controlled.value)}
        />
      )}
    />
  )
}

interface CheckboxFieldInputProps extends ControlledFieldProps<ClientCheckboxField> {
  isLocked?: boolean
  hasLocalization?: boolean
  isLocalized?: boolean
  fullName?: string
}

function CheckboxFieldInput({
  field,
  control,
  a11y,
  disabled,
  isLocked,
  hasLocalization,
  isLocalized,
  fullName,
}: CheckboxFieldInputProps) {
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
            disabled={disabled || controlled.disabled}
            {...a11yProps(a11y)}
          />
          <Label
            htmlFor={field.name}
            className="lt:cursor-pointer lt:select-none lt:flex lt:items-center lt:gap-1.5"
          >
            <span>{field.label}</span>
            {field.required && <span className="lontar-required">*</span>}
            <FieldLocalizationBadge
              hasLocalization={hasLocalization}
              isLocalized={isLocalized}
              fullName={fullName ?? field.name}
            />
            {isLocked && (
              <span title="Read-only" className="lt:inline-flex lt:items-center">
                <Lock
                  className="lt:size-3.5 lt:text-muted-foreground lt:ml-1"
                  data-testid={`locked-icon-${field.name}`}
                  aria-label="Read-only"
                />
              </span>
            )}
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
  disabled,
}: ControlledFieldProps<ClientSelectField>) {
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
            disabled={disabled || controlled.disabled}
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

function DateFieldInput({ field, control, a11y, disabled }: ControlledFieldProps<ClientDateField>) {
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
          disabled={disabled || controlled.disabled}
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
  disabled,
  placeholder,
}: ControlledFieldProps<ClientSlugField> & {
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  placeholder?: string
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
            placeholder={placeholder}
            disabled={disabled || controlled.disabled}
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
          disabled={disabled}
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

interface RichTextFieldInputProps {
  field: ClientRichTextField
  register: FormRegister
  setValue?: FormSetValue
  watch?: FormWatch
  disabled?: boolean
}

function RichTextFieldInput({
  field,
  register,
  setValue,
  watch,
  disabled,
}: RichTextFieldInputProps) {
  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const value = watch ? (watch(field.name) as Record<string, unknown> | undefined) : undefined

  return (
    <RichTextEditor
      name={field.name}
      value={value}
      disabled={disabled}
      onChange={(newVal) => {
        setValue?.(field.name, newVal, { shouldValidate: true, shouldDirty: true })
      }}
    />
  )
}

// Every standard field type is bound through Controller now; `register` is
// only still used by the fields that enroll a value without spreading it onto
// an element (richText, relationship, upload).
interface StandardFieldInputProps {
  field: ClientField
  control: FormControl
  a11y: FieldA11y
  disabled?: boolean
  isLocked?: boolean
  placeholder?: string
  hasLocalization?: boolean
  isLocalized?: boolean
  fullName?: string
}

function StandardFieldInput(props: StandardFieldInputProps) {
  const { field } = props
  switch (field.type) {
    case 'text':
      return <TextFieldInput {...props} field={field} />
    case 'number':
      return <NumberFieldInput {...props} field={field} />
    case 'textarea':
      return <TextareaFieldInput {...props} field={field} />
    case 'code':
      return <CodeFieldInput {...props} field={field} />
    case 'email':
      return <EmailFieldInput {...props} field={field} />
    case 'checkbox':
      return <CheckboxFieldInput {...props} field={field} />
    case 'select':
      return <SelectFieldInput {...props} field={field} />
    case 'date':
      return <DateFieldInput {...props} field={field} />
    default:
      return null
  }
}

interface FieldInputProps {
  field: ClientField
  control: FormControl
  register: FormRegister
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  a11y: FieldA11y
  disabled?: boolean
  isLocked?: boolean
  placeholder?: string
  hasLocalization?: boolean
  isLocalized?: boolean
  fullName?: string
  errorMessage?: string
}

function FieldInput(props: FieldInputProps) {
  const { field } = props
  if (field.component) {
    return (
      <CustomFieldInput
        field={field}
        component={field.component}
        fullName={props.fullName ?? field.name}
        control={props.control}
        disabled={props.disabled}
        isLocked={props.isLocked}
        errorMessage={props.errorMessage}
      />
    )
  }
  switch (field.type) {
    case 'slug':
      return <SlugFieldInput {...props} field={field} />
    case 'richText':
      return <RichTextFieldInput {...props} field={field} />
    case 'relationship':
      return <RelationshipPicker {...props} field={field} />
    case 'upload':
      return <UploadPicker {...props} field={field} />
    default:
      return <StandardFieldInput {...props} field={field} />
  }
}

interface GroupFieldRendererProps {
  field: ClientGroupField
  fullName: string
  control: FormControl
  register: FormRegister
  error?: { message?: string } | Record<string, unknown>
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  permissions?: FieldPermission
  disabled?: boolean
  readOnlyDoc?: boolean
  isLocked?: boolean
  fallbackValue?: unknown
  hasLocalization?: boolean
  parentLocalized?: boolean
}

function extractSubProperty(obj: unknown, key: string): unknown {
  if (obj && typeof obj === 'object' && Object.hasOwn(obj, key)) {
    return (obj as Record<string, unknown>)[key]
  }
  return undefined
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
  permissions,
  disabled,
  readOnlyDoc,
  isLocked,
  fallbackValue,
  hasLocalization,
  parentLocalized,
}: GroupFieldRendererProps) {
  const isLocalized = Boolean(field.localized || parentLocalized)

  return (
    <fieldset
      className="lontar-field-group lt:rounded-lg lt:border lt:border-border lt:p-4 lt:flex lt:flex-col lt:gap-4"
      data-group={fullName}
    >
      <legend className="lt:text-sm lt:font-semibold lt:text-foreground lt:px-1 lt:flex lt:items-center lt:gap-1.5">
        <span>{field.label}</span>
        {field.required && <span className="lontar-required lt:ml-1 lt:text-destructive">*</span>}
        <FieldLocalizationBadge
          hasLocalization={hasLocalization}
          isLocalized={isLocalized}
          fullName={fullName}
        />
        {isLocked && (
          <span title="Read-only" className="lt:inline-flex lt:items-center">
            <Lock
              className="lt:size-3.5 lt:text-muted-foreground lt:ml-1"
              data-testid={`locked-icon-${fullName}`}
              aria-label="Read-only"
            />
          </span>
        )}
      </legend>
      {field.fields.map((subField) => {
        const subPerm = permissions?.fields?.[subField.name]
        if (subPerm && subPerm.read === false) return null

        const subError = extractSubProperty(error, subField.name)
        const subFallback = extractSubProperty(fallbackValue, subField.name)

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
            permissions={subPerm}
            disabled={disabled}
            readOnlyDoc={readOnlyDoc}
            fallbackValue={subFallback}
            hasLocalization={hasLocalization}
            parentLocalized={isLocalized}
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
  control: FormControl
  register: FormRegister
  error?: { message?: string } | Record<string, unknown>
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  permissions?: FieldPermission
  disabled?: boolean
  readOnlyDoc?: boolean
  hasLocalization?: boolean
  parentLocalized?: boolean
}

interface ArrayRowRendererProps {
  field: ClientArrayField
  index: number
  totalRows: number
  minRows: number
  maxRows: number
  rowPath: string
  control: FormControl
  register: FormRegister
  rowError?: Record<string, unknown>
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  permissions?: FieldPermission
  disabled?: boolean
  readOnlyDoc?: boolean
  hasLocalization?: boolean
  parentLocalized?: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  onDuplicate: () => void
}

function getRowLabelFromSubfields(
  field: ClientArrayField,
  rowPath: string,
  watch?: FormWatch,
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
  watch?: FormWatch,
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
  permissions,
  disabled,
  readOnlyDoc,
  hasLocalization,
  parentLocalized,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDuplicate,
}: ArrayRowRendererProps) {
  const [collapsed, setCollapsed] = useState(false)
  const label = getRowLabel(field, index, rowPath, watch)

  return (
    <div
      className="lontar-array-row lt:rounded-md lt:border lt:border-border lt:bg-card lt:overflow-hidden"
      data-array-row={index}
    >
      <div className="lt:flex lt:items-center lt:justify-between lt:gap-2 lt:px-3 lt:py-2 lt:bg-muted/50 lt:border-b lt:border-border">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="lt:flex lt:items-center lt:gap-2 lt:text-sm lt:font-medium lt:text-foreground lt:hover:text-primary lt:focus-visible:outline-none lt:cursor-pointer"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          {collapsed ? (
            <ChevronRight className="lt:size-4 lt:text-muted-foreground" />
          ) : (
            <ChevronDown className="lt:size-4 lt:text-muted-foreground" />
          )}
          <span>{label}</span>
        </button>

        <div className="lt:flex lt:items-center lt:gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7"
            disabled={index === 0 || disabled}
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
            disabled={index === totalRows - 1 || disabled}
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
            disabled={totalRows >= maxRows || disabled}
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
            className="lt:size-7 lt:text-destructive lt:hover:bg-destructive/10"
            disabled={totalRows <= minRows || disabled}
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
            const subPerm = permissions?.fields?.[subField.name]
            if (subPerm?.read === false) {
              return null
            }
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
                permissions={subPerm}
                disabled={disabled}
                readOnlyDoc={readOnlyDoc}
                hasLocalization={hasLocalization}
                parentLocalized={parentLocalized}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ArrayHeaderProps {
  label: string
  required: boolean
  description?: string
  rowCount: number
  maxRows: number
  hasBounds: boolean
  isLocked?: boolean
  fullName?: string
  hasLocalization?: boolean
  isLocalized?: boolean
}

function ArrayHeader({
  label,
  required,
  description,
  rowCount,
  maxRows,
  hasBounds,
  isLocked,
  fullName,
  hasLocalization,
  isLocalized,
}: ArrayHeaderProps) {
  return (
    <div className="lt:flex lt:items-center lt:justify-between lt:gap-2">
      <div>
        <legend className="lt:text-sm lt:font-semibold lt:text-foreground lt:px-1 lt:flex lt:items-center lt:gap-1.5">
          <span>{label}</span>
          {required && <span className="lontar-required lt:text-destructive">*</span>}
          {fullName && (
            <FieldLocalizationBadge
              hasLocalization={hasLocalization}
              isLocalized={isLocalized}
              fullName={fullName}
            />
          )}
          {isLocked && (
            <span title="Read-only" className="lt:inline-flex lt:items-center">
              <Lock
                className="lt:size-3.5 lt:text-muted-foreground"
                data-testid={fullName ? `locked-icon-${fullName}` : undefined}
                aria-label="Read-only"
              />
            </span>
          )}
        </legend>
        {description && (
          <p className="lt:text-xs lt:text-muted-foreground lt:px-1 lt:mt-0.5">{description}</p>
        )}
      </div>
      {hasBounds && (
        <span className="lt:text-xs lt:text-muted-foreground">
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

function getArrayBounds(field: ClientArrayField) {
  const minRows = field.minRows ?? (field.required ? 1 : 0)
  const maxRows = field.maxRows ?? 100
  const hasBounds = field.minRows !== undefined || field.maxRows !== undefined
  const singular = field.labels?.singular || field.label || 'Row'
  return { minRows, maxRows, hasBounds, singular }
}

function cloneRowData(data: unknown, fields: ClientField[]): Record<string, unknown> {
  const cloned =
    data && typeof data === 'object'
      ? { ...(data as Record<string, unknown>) }
      : computeDefaultValues(fields)
  cloned.id = generateRowId()
  return cloned
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
  permissions,
  disabled,
  readOnlyDoc,
  hasLocalization,
  parentLocalized,
}: ArrayFieldRendererProps) {
  const { fields, append, remove, move, insert } = useFieldArray({
    control,
    name: fullName as never,
  })

  const { minRows, maxRows, hasBounds, singular } = getArrayBounds(field)
  const rootErrorMessage = getErrorMessage(error)

  const isLocked = isFieldReadOnly(permissions, mode, readOnlyDoc)
  const effectiveDisabled = disabled || isLocked
  const isLocalized = Boolean(field.localized || parentLocalized)

  return (
    <fieldset
      className="lontar-field-array lt:rounded-lg lt:border lt:border-border lt:p-4 lt:flex lt:flex-col lt:gap-4"
      data-array={fullName}
    >
      <ArrayHeader
        label={field.label}
        required={field.required}
        description={field.admin?.description}
        rowCount={fields.length}
        maxRows={maxRows}
        hasBounds={hasBounds}
        isLocked={isLocked}
        fullName={fullName}
        hasLocalization={hasLocalization}
        isLocalized={isLocalized}
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
              permissions={permissions}
              disabled={effectiveDisabled}
              readOnlyDoc={readOnlyDoc}
              hasLocalization={hasLocalization}
              parentLocalized={isLocalized}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              onRemove={() => remove(index)}
              onDuplicate={() => {
                const currentData: unknown = watch ? watch(rowPath as never) : undefined
                insert(index + 1, cloneRowData(currentData, field.fields))
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
          disabled={fields.length >= maxRows || effectiveDisabled}
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
  control: FormControl
  register: FormRegister
  rowError?: Record<string, unknown>
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  permissions?: FieldPermission
  disabled?: boolean
  readOnlyDoc?: boolean
  hasLocalization?: boolean
  parentLocalized?: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  onDuplicate: () => void
}

function getBlockRowLabel(
  block: ClientBlock,
  index: number,
  rowPath: string,
  watch?: FormWatch,
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
  permissions,
  disabled,
  readOnlyDoc,
  hasLocalization,
  parentLocalized,
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
      className="lontar-block-row lt:rounded-md lt:border lt:border-border lt:bg-card lt:overflow-hidden"
      data-block-row={index}
      data-block-type={block.slug}
    >
      <div className="lt:flex lt:items-center lt:justify-between lt:gap-2 lt:px-3 lt:py-2 lt:bg-muted/50 lt:border-b lt:border-border">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="lt:flex lt:items-center lt:gap-2 lt:text-sm lt:font-medium lt:text-foreground lt:hover:text-primary lt:focus-visible:outline-none lt:cursor-pointer"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          {collapsed ? (
            <ChevronRight className="lt:size-4 lt:text-muted-foreground" />
          ) : (
            <ChevronDown className="lt:size-4 lt:text-muted-foreground" />
          )}
          <span>{label}</span>
        </button>

        <div className="lt:flex lt:items-center lt:gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lt:size-7"
            disabled={index === 0 || disabled}
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
            disabled={index === totalRows - 1 || disabled}
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
            disabled={totalRows >= maxRows || disabled}
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
            className="lt:size-7 lt:text-destructive lt:hover:bg-destructive/10"
            disabled={totalRows <= minRows || disabled}
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
            const blockPerm = permissions?.blocks?.[block.slug]
            const subPerm = blockPerm?.fields?.[subField.name]
            if (subPerm?.read === false) {
              return null
            }
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
                permissions={subPerm}
                disabled={disabled}
                readOnlyDoc={readOnlyDoc}
                hasLocalization={hasLocalization}
                parentLocalized={parentLocalized}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface AddBlockPickerProps {
  blocks: readonly ClientBlock[]
  disabled: boolean
  onSelectBlock: (block: ClientBlock) => void
}

function AddBlockPicker({ blocks, disabled, onSelectBlock }: AddBlockPickerProps) {
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
            className="lt:w-full lt:flex lt:items-center lt:justify-between lt:px-3 lt:py-2 lt:text-sm lt:rounded-sm lt:hover:bg-accent lt:text-left lt:cursor-pointer lt:text-foreground"
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
  control: FormControl
  register: FormRegister
  error?: { message?: string } | Record<string, unknown>
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  permissions?: FieldPermission
  disabled?: boolean
  readOnlyDoc?: boolean
  hasLocalization?: boolean
  parentLocalized?: boolean
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
  permissions,
  disabled,
  readOnlyDoc,
  hasLocalization,
  parentLocalized,
}: BlocksFieldRendererProps) {
  const { fields, append, remove, move, insert } = useFieldArray({
    control,
    name: fullName as never,
  })

  const minRows = field.minRows ?? (field.required ? 1 : 0)
  const maxRows = field.maxRows ?? 100
  const rootErrorMessage = getErrorMessage(error)
  const hasBounds = field.minRows !== undefined || field.maxRows !== undefined

  const isLocked = isFieldReadOnly(permissions, mode, readOnlyDoc)
  const effectiveDisabled = disabled || isLocked
  const isLocalized = Boolean(field.localized || parentLocalized)

  return (
    <fieldset
      className="lontar-field-blocks lt:rounded-lg lt:border lt:border-border lt:p-4 lt:flex lt:flex-col lt:gap-4"
      data-blocks={fullName}
    >
      <ArrayHeader
        label={field.label}
        required={field.required}
        description={field.admin?.description}
        rowCount={fields.length}
        maxRows={maxRows}
        hasBounds={hasBounds}
        isLocked={isLocked}
        fullName={fullName}
        hasLocalization={hasLocalization}
        isLocalized={isLocalized}
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
              permissions={permissions}
              disabled={effectiveDisabled}
              readOnlyDoc={readOnlyDoc}
              hasLocalization={hasLocalization}
              parentLocalized={isLocalized}
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
          disabled={fields.length >= maxRows || effectiveDisabled}
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
  control: FormControl
  register: FormRegister
  errorMessage?: string
  setValue?: FormSetValue
  watch?: FormWatch
  mode?: 'create' | 'edit'
  disabled?: boolean
  isLocked?: boolean
  fallbackValue?: unknown
  hasLocalization?: boolean
  parentLocalized?: boolean
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
  disabled,
  isLocked,
  fallbackValue,
  hasLocalization,
  parentLocalized,
}: StandardFieldRendererProps) {
  const errorId = `${fullName}-error`
  const hasError = Boolean(errorMessage)
  const a11y: FieldA11y = {
    describedBy: hasError ? errorId : undefined,
    invalid: hasError,
    required: field.required,
  }
  const isLocalized = Boolean(field.localized || parentLocalized)
  const placeholder = resolveFallbackPlaceholder(fallbackValue)

  return (
    <Field className="lontar-field-group" data-invalid={hasError || undefined}>
      {(field.type !== 'checkbox' || field.component) && (
        <FieldLabel htmlFor={fullName} className="lontar-label">
          <span>{field.label}</span>
          {field.required && <span className="lontar-required">*</span>}
          <FieldLocalizationBadge
            hasLocalization={hasLocalization}
            isLocalized={isLocalized}
            fullName={fullName}
          />
          {isLocked && (
            <span title="Read-only" className="lt:inline-flex lt:items-center">
              <Lock
                className="lt:size-3.5 lt:text-muted-foreground lt:ml-1"
                data-testid={`locked-icon-${fullName}`}
                aria-label="Read-only"
              />
            </span>
          )}
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
        disabled={disabled}
        isLocked={isLocked}
        placeholder={placeholder}
        hasLocalization={hasLocalization}
        isLocalized={isLocalized}
        fullName={fullName}
        errorMessage={errorMessage}
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
  permissions,
  disabled,
  readOnlyDoc,
  fallbackValue,
  hasLocalization,
  parentLocalized,
}: FieldRendererProps) {
  const fullName = pathPrefix ? `${pathPrefix}.${field.name}` : field.name

  if (field.type === 'group') {
    const isLocked = isFieldReadOnly(permissions, mode, readOnlyDoc)
    const effectiveDisabled = disabled || isLocked
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
        permissions={permissions}
        disabled={effectiveDisabled}
        readOnlyDoc={readOnlyDoc}
        isLocked={isLocked}
        fallbackValue={fallbackValue}
        hasLocalization={hasLocalization}
        parentLocalized={parentLocalized}
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
        permissions={permissions}
        disabled={disabled}
        readOnlyDoc={readOnlyDoc}
        hasLocalization={hasLocalization}
        parentLocalized={parentLocalized}
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
        permissions={permissions}
        disabled={disabled}
        readOnlyDoc={readOnlyDoc}
        hasLocalization={hasLocalization}
        parentLocalized={parentLocalized}
      />
    )
  }

  const isLocked = isFieldReadOnly(permissions, mode, readOnlyDoc)
  const effectiveDisabled = disabled || isLocked
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
      disabled={effectiveDisabled}
      isLocked={isLocked}
      fallbackValue={fallbackValue}
      hasLocalization={hasLocalization}
      parentLocalized={parentLocalized}
    />
  )
}

function buildWatchedRootValues(
  watchedPaths: string[],
  watchedValues: unknown,
  fallbackWatch?: () => Record<string, unknown>,
): Record<string, unknown> {
  if (watchedPaths.length > 0) {
    if (Array.isArray(watchedValues)) {
      const root: Record<string, unknown> = {}
      watchedPaths.forEach((path, i) => {
        setValueByPath(root, path, watchedValues[i])
      })
      return root
    }
    return fallbackWatch ? fallbackWatch() : {}
  }
  if (watchedValues && typeof watchedValues === 'object' && !Array.isArray(watchedValues)) {
    return watchedValues as Record<string, unknown>
  }
  return fallbackWatch ? fallbackWatch() : {}
}

function ConditionalFieldRenderer(props: FieldRendererProps & { condition: FieldCondition }) {
  const watchedPaths = useMemo(
    () => extractConditionPaths(props.condition, props.pathPrefix),
    [props.condition, props.pathPrefix],
  )

  const watchedValues: unknown = useWatch({
    control: props.control,
    name: (watchedPaths.length > 0 ? (watchedPaths as readonly string[]) : undefined) as never,
  })

  const rootValues = buildWatchedRootValues(
    watchedPaths,
    watchedValues,
    props.watch ? () => props.watch!() : undefined,
  )

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
  if (props.permissions?.read === false) {
    return null
  }
  if (props.field.condition) {
    return <ConditionalFieldRenderer {...props} condition={props.field.condition} />
  }
  return <UnconditionalFieldRenderer {...props} />
}
