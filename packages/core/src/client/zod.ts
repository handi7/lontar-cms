import { z } from 'zod'
import type {
  ClientCheckboxField,
  ClientDateField,
  ClientEmailField,
  ClientField,
  ClientNumberField,
  ClientSelectField,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
} from './client-config'

/*
 * The one place field rules become validation (docs/adr/0003-client-config-format.md).
 * The server runs its fields through toClientConfig() and then these same
 * functions, so the API and the admin forms cannot disagree.
 */
const zodByType = {
  text: (field: ClientTextField) => {
    // A required text field must not be blank, whatever its minLength.
    const minLength = Math.max(field.minLength ?? 0, field.required ? 1 : 0)
    let schema = z.string()
    if (minLength > 0) schema = schema.min(minLength)
    if (field.maxLength !== undefined) schema = schema.max(field.maxLength)
    return schema
  },
  number: (field: ClientNumberField) => {
    let schema = z.number()
    if (field.integer) schema = schema.int()
    if (field.min !== undefined) schema = schema.min(field.min)
    if (field.max !== undefined) schema = schema.max(field.max)
    return schema
  },
  textarea: (field: ClientTextareaField) => {
    const minLength = Math.max(field.minLength ?? 0, field.required ? 1 : 0)
    let schema = z.string()
    if (minLength > 0) schema = schema.min(minLength)
    if (field.maxLength !== undefined) schema = schema.max(field.maxLength)
    return schema
  },
  email: (field: ClientEmailField) => {
    if (field.required) {
      return z.string().min(1, 'Email is required').email('Invalid email address')
    }
    return z.string().email('Invalid email address').or(z.literal(''))
  },
  slug: (field: ClientSlugField) => {
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    if (field.required) {
      return z
        .string()
        .min(1, 'Slug is required')
        .regex(slugRegex, 'Must be a valid URL slug (lowercase letters, numbers, and hyphens)')
    }
    return z
      .string()
      .regex(slugRegex, 'Must be a valid URL slug (lowercase letters, numbers, and hyphens)')
      .or(z.literal(''))
  },
  checkbox: (_field: ClientCheckboxField) => {
    return z.boolean()
  },
  select: (field: ClientSelectField) => {
    const [first, ...rest] = field.options.map((o) => o.value)
    if (!first) {
      return z.string()
    }
    const enumSchema = z.enum([first, ...rest])
    if (field.required) {
      return enumSchema
    }
    return enumSchema.or(z.literal(''))
  },
  date: (field: ClientDateField) => {
    const dateSchema = z.union([
      z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: 'Invalid date format',
      }),
      z.date(),
    ])
    if (field.required) {
      return dateSchema
    }
    return dateSchema.or(z.literal(''))
  },
} satisfies { [K in ClientField['type']]: (field: Extract<ClientField, { type: K }>) => z.ZodType }

/** Optional fields accept `null` and `undefined`, since their column is nullable. */
export function clientFieldToZod(field: ClientField): z.ZodType {
  // TypeScript cannot match `field.type` to its converter's parameter, hence the cast.
  const toZod = zodByType[field.type] as (field: ClientField) => z.ZodType
  const schema = toZod(field)
  return field.required ? schema : schema.nullish()
}

/**
 * Object schema for a document's fields. Unknown keys, system fields included,
 * are stripped, so a client cannot set `id` or the timestamps.
 */
export function clientFieldsToZod(fields: readonly ClientField[]) {
  return z.object(Object.fromEntries(fields.map((field) => [field.name, clientFieldToZod(field)])))
}
