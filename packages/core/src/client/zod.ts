import { z } from 'zod'
import { matchesCondition } from './condition'
import type {
  ClientArrayField,
  ClientBlocksField,
  ClientCheckboxField,
  ClientDateField,
  ClientEmailField,
  ClientField,
  ClientGroupField,
  ClientNumberField,
  ClientRelationshipField,
  ClientRichTextField,
  ClientSelectField,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
  ClientUploadField,
} from './client-config'

import { generateRowId } from './id'

const MAX_INT_32 = 2147483647
const DEFAULT_STRING_MAX_LENGTH = 255

export function isRichTextEmpty(val: unknown): boolean {
  if (!val || typeof val !== 'object') return true
  const doc = val as { type?: string; text?: string; content?: unknown[] }
  if (typeof doc.text === 'string') {
    return doc.text.trim().length === 0
  }
  if (Array.isArray(doc.content)) {
    if (doc.content.length === 0) return true
    return doc.content.every((child) => isRichTextEmpty(child))
  }
  if (doc.type && doc.type !== 'doc' && doc.type !== 'paragraph') {
    return false
  }
  return true
}

/*
 * The one place field rules become validation (docs/adr/0003-client-config-format.md).
 * The server runs its fields through toClientConfig() and then these same
 * functions, so the API and the admin forms cannot disagree.
 */
const zodByType = {
  text: (field: ClientTextField) => {
    const maxLength = field.maxLength ?? DEFAULT_STRING_MAX_LENGTH
    if (field.required) {
      const minLength = Math.max(field.minLength ?? 1, 1)
      return z.string().min(minLength).max(maxLength)
    }
    const schema = z.string().max(maxLength)
    if (field.minLength !== undefined && field.minLength > 0) {
      return schema.min(field.minLength).or(z.literal(''))
    }
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
    if (field.required) {
      const minLength = Math.max(field.minLength ?? 1, 1)
      let schema = z.string().min(minLength)
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength)
      return schema
    }
    let schema = z.string()
    if (field.maxLength !== undefined) schema = schema.max(field.maxLength)
    if (field.minLength !== undefined && field.minLength > 0) {
      return schema.min(field.minLength).or(z.literal(''))
    }
    return schema
  },
  email: (field: ClientEmailField) => {
    const maxLength = field.maxLength ?? DEFAULT_STRING_MAX_LENGTH
    if (field.required) {
      return z.string().min(1, 'Email is required').max(maxLength).email('Invalid email address')
    }
    return z.string().max(maxLength).email('Invalid email address').or(z.literal(''))
  },
  slug: (field: ClientSlugField) => {
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    const maxLength = field.maxLength ?? DEFAULT_STRING_MAX_LENGTH
    if (field.required) {
      return z
        .string()
        .min(1, 'Slug is required')
        .max(maxLength)
        .regex(slugRegex, 'Must be a valid URL slug (lowercase letters, numbers, and hyphens)')
    }
    return z
      .string()
      .max(maxLength)
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
  richText: (field: ClientRichTextField) => {
    const base = z.record(z.string(), z.unknown())
    if (field.required) {
      return base.refine((val) => !isRichTextEmpty(val), {
        message: 'Rich text content is required',
      })
    }
    return base
  },
  relationship: (field: ClientRelationshipField) => {
    const idSchema = z.number().int().positive().max(MAX_INT_32)
    if (field.hasMany) {
      const arr = z.array(idSchema)
      return field.required ? arr.min(1, 'At least one relation is required') : arr
    }
    return idSchema
  },
  upload: (_field: ClientUploadField) => {
    return z.number().int().positive().max(MAX_INT_32)
  },
  group: (field: ClientGroupField) => {
    return clientFieldsToObject(field.fields)
  },
  array: (field: ClientArrayField) => {
    const rowSchema = clientFieldsToObject(field.fields).extend({
      id: z
        .string()
        .optional()
        .transform((val) => val || generateRowId()),
    })
    let arr = z.array(rowSchema)
    const minRows = field.minRows ?? (field.required ? 1 : 0)
    if (minRows > 0) {
      arr = arr.min(minRows, `Must have at least ${minRows} ${minRows === 1 ? 'item' : 'items'}`)
    }
    const maxRows = field.maxRows ?? 100
    arr = arr.max(maxRows, `Must have at most ${maxRows} items`)
    return arr
  },
  blocks: (field: ClientBlocksField) => {
    const blockSchemas = field.blocks.map((b) => {
      return clientFieldsToObject(b.fields).extend({
        id: z
          .string()
          .optional()
          .transform((val) => val || generateRowId()),
        blockType: z.literal(b.slug),
      })
    })

    const rowSchema =
      blockSchemas.length === 0
        ? z.never()
        : blockSchemas.length === 1
          ? blockSchemas[0]!
          : z.discriminatedUnion('blockType', [
              blockSchemas[0]!,
              blockSchemas[1]!,
              ...blockSchemas.slice(2),
            ])

    let arr = z.array(rowSchema)
    const minRows = field.minRows ?? (field.required ? 1 : 0)
    if (minRows > 0) {
      arr = arr.min(minRows, `Must have at least ${minRows} ${minRows === 1 ? 'item' : 'items'}`)
    }
    const maxRows = field.maxRows ?? 100
    arr = arr.max(maxRows, `Must have at most ${maxRows} items`)
    return arr
  },
} satisfies { [K in ClientField['type']]: (field: Extract<ClientField, { type: K }>) => z.ZodType }

/** Optional fields accept `null` and `undefined`, since their column is nullable. */
export function clientFieldToZod(field: ClientField, forceValidation = false): z.ZodType {
  if (!forceValidation && field.condition) {
    return z.unknown().optional()
  }
  // TypeScript cannot match `field.type` to its converter's parameter, hence the cast.
  const toZod = zodByType[field.type] as (field: ClientField) => z.ZodType
  const schema = toZod(field)
  return field.required ? schema : schema.nullish()
}

/**
 * Returns a plain ZodObject for an array of fields without superRefine wrapper.
 */
export function clientFieldsToObject(fields: readonly ClientField[]) {
  return z.object(Object.fromEntries(fields.map((field) => [field.name, clientFieldToZod(field)])))
}

function hasConditionalFields(fields: readonly ClientField[]): boolean {
  return fields.some((f) => {
    if (f.condition) return true
    if (f.type === 'group') return hasConditionalFields(f.fields)
    if (f.type === 'array') return hasConditionalFields(f.fields)
    if (f.type === 'blocks') {
      return f.blocks.some((b) => hasConditionalFields(b.fields))
    }
    return false
  })
}

function validateSingleField(
  field: ClientField,
  container: Record<string, unknown>,
  rootData: Record<string, unknown>,
  siblingData: Record<string, unknown>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  isPartial?: boolean,
): void {
  if (!field.condition) return
  const isVisible = matchesCondition(field.condition, rootData, siblingData)
  if (!isVisible) return

  if (isPartial && !(field.name in container)) return

  const val = container[field.name]
  const schema = clientFieldToZod(field, true)
  const res = schema.safeParse(val)
  if (!res.success) {
    for (const issue of res.error.issues) {
      ctx.addIssue({
        ...issue,
        path: [...path, field.name, ...issue.path],
      })
    }
  }
}

function validateNestedGroup(
  field: ClientGroupField,
  container: Record<string, unknown>,
  rootData: Record<string, unknown>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  isPartial?: boolean,
): void {
  const groupVal = container[field.name]
  if (!groupVal || typeof groupVal !== 'object') return
  validateConditionalFields({
    fields: field.fields,
    data: groupVal,
    rootData,
    siblingData: groupVal as Record<string, unknown>,
    path: [...path, field.name],
    ctx,
    isPartial,
  })
}

function validateNestedArray(
  field: ClientArrayField,
  container: Record<string, unknown>,
  rootData: Record<string, unknown>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const raw = container[field.name]
  if (!Array.isArray(raw)) return
  const arr = raw as readonly unknown[]
  for (let index = 0; index < arr.length; index++) {
    const row = arr[index]
    if (row && typeof row === 'object') {
      validateConditionalFields({
        fields: field.fields,
        data: row,
        rootData,
        siblingData: row as Record<string, unknown>,
        path: [...path, field.name, index],
        ctx,
        isPartial: false,
      })
    }
  }
}

function validateNestedBlocks(
  field: ClientBlocksField,
  container: Record<string, unknown>,
  rootData: Record<string, unknown>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const raw = container[field.name]
  if (!Array.isArray(raw)) return
  const arr = raw as readonly unknown[]
  for (let index = 0; index < arr.length; index++) {
    const row = arr[index]
    if (row && typeof row === 'object') {
      const record = row as Record<string, unknown>
      const blockType = record.blockType
      const blockDef = field.blocks.find((b) => b.slug === blockType)
      if (blockDef) {
        validateConditionalFields({
          fields: blockDef.fields,
          data: record,
          rootData,
          siblingData: record,
          path: [...path, field.name, index],
          ctx,
          isPartial: false,
        })
      }
    }
  }
}

function validateConditionalFields({
  fields,
  data,
  rootData,
  siblingData,
  path,
  ctx,
  isPartial,
}: {
  fields: readonly ClientField[]
  data: unknown
  rootData: Record<string, unknown>
  siblingData?: Record<string, unknown>
  path: (string | number)[]
  ctx: z.RefinementCtx
  isPartial?: boolean
}): void {
  if (!data || typeof data !== 'object') return
  const container = data as Record<string, unknown>
  const currentSibling = siblingData ?? container

  for (const field of fields) {
    validateSingleField(field, container, rootData, currentSibling, path, ctx, isPartial)
    if (field.type === 'group') {
      validateNestedGroup(field, container, rootData, path, ctx, isPartial)
    } else if (field.type === 'array') {
      validateNestedArray(field, container, rootData, path, ctx)
    } else if (field.type === 'blocks') {
      validateNestedBlocks(field, container, rootData, path, ctx)
    }
  }
}

/**
 * Object schema for a document's fields. Unknown keys, system fields included,
 * are stripped, so a client cannot set `id` or the timestamps.
 */
export function clientFieldsToZod(fields: readonly ClientField[], options?: { partial?: boolean }) {
  const isPartial = Boolean(options?.partial)
  const baseObj = clientFieldsToObject(fields)
  const base = isPartial ? baseObj.partial() : baseObj

  if (!hasConditionalFields(fields)) {
    return base
  }

  const effects = base.superRefine((data, ctx) => {
    validateConditionalFields({
      fields,
      data,
      rootData: data,
      path: [],
      ctx,
      isPartial,
    })
  })

  ;(effects as unknown as { partial: () => typeof effects }).partial = () =>
    clientFieldsToZod(fields, { partial: true })

  return effects
}
