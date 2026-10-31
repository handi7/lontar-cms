import { z } from 'zod'
import type { ClientField, ClientNumberField, ClientTextField } from './client-config'

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
