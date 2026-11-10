import {
  generateRowId,
  sanitizeConditionalFields,
  type ClientArrayField,
  type ClientField,
} from '@lontar/core/client'

/**
 * Format a stored date (ISO string, timestamp, or Date) to local YYYY-MM-DDTHH:mm
 * for an HTML `<input type="datetime-local">`.
 */
export function formatDateForInput(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const d = new Date(val as string | number | Date)
  if (Number.isNaN(d.getTime())) {
    return typeof val === 'string' ? val : ''
  }
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = d.getSeconds()
  if (seconds !== 0) {
    const secStr = String(seconds).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}:${secStr}`
  }
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

/**
 * Convert a local datetime-local string (or Date) back to an absolute ISO-8601 UTC string.
 */
export function formatDateForSubmit(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (!trimmed) return null
    const d = new Date(trimmed)
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString()
    }
    return trimmed
  }
  if (val instanceof Date) {
    return !Number.isNaN(val.getTime()) ? val.toISOString() : null
  }
  return null
}

export function extractIdFromItem(item: unknown): number | null {
  if (typeof item === 'number' && item > 0) return item
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const id = (item as Record<string, unknown>).id
    if (typeof id === 'number' && id > 0) return id
  }
  return null
}

export function normalizeRelationshipValue(val: unknown, hasMany?: boolean): unknown {
  if (hasMany) {
    if (!Array.isArray(val)) return []
    return (val as unknown[]).map(extractIdFromItem).filter((id): id is number => id !== null)
  }
  return extractIdFromItem(val) ?? val
}

function formatNestedFieldForForm(f: ClientField, val: unknown): unknown {
  if (f.type === 'group') {
    if (!val || typeof val !== 'object') return val
    return formatDocForForm(f.fields, val as Record<string, unknown>)
  }
  if (f.type === 'array') {
    if (!Array.isArray(val)) return []
    return (val as Array<Record<string, unknown>>).map((row) =>
      row && typeof row === 'object' ? formatDocForForm(f.fields, row) : row,
    )
  }
  if (f.type === 'blocks') {
    if (!Array.isArray(val)) return []
    return (val as Array<Record<string, unknown>>).map((row) => {
      if (!row || typeof row !== 'object') return row
      const blockDef = f.blocks.find((b) => b.slug === row.blockType)
      return blockDef ? formatDocForForm(blockDef.fields, row) : row
    })
  }
  return val
}

export function formatFieldForForm(f: ClientField, val: unknown): unknown {
  if (f.type === 'date') {
    return formatDateForInput(val)
  }
  if (f.type === 'relationship') {
    return normalizeRelationshipValue(val, f.hasMany)
  }
  if (f.type === 'upload') {
    return extractIdFromItem(val) ?? val
  }
  return formatNestedFieldForForm(f, val)
}

const EXCLUDED_FORM_SYSTEM_FIELDS = [
  'createdAt',
  'updatedAt',
  '_status',
  '_isPublished',
  'latestVersionId',
] as const

export function formatDocForForm(
  fields: readonly ClientField[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const formatted = { ...data }
  for (const sysField of EXCLUDED_FORM_SYSTEM_FIELDS) {
    delete formatted[sysField]
  }
  for (const f of fields) {
    if (f.name in formatted) {
      formatted[f.name] = formatFieldForForm(f, formatted[f.name])
    }
  }
  return formatted
}

function formatNestedValueForSubmit(f: ClientField, val: unknown): unknown {
  if (f.type === 'group' && val && typeof val === 'object') {
    return formatDocForSubmit(f.fields, val as Record<string, unknown>)
  }
  if (f.type === 'array' && Array.isArray(val)) {
    const rows = val as readonly unknown[]
    return rows.map((row) =>
      row && typeof row === 'object'
        ? formatDocForSubmit(f.fields, row as Record<string, unknown>)
        : row,
    )
  }
  if (f.type === 'blocks' && Array.isArray(val)) {
    const rows = val as readonly unknown[]
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row
      const record = row as Record<string, unknown>
      const blockDef = f.blocks.find((b) => b.slug === record.blockType)
      return blockDef ? formatDocForSubmit(blockDef.fields, record) : record
    })
  }
  return val
}

function formatFieldValueForSubmit(f: ClientField, val: unknown): unknown {
  if (f.type === 'date') {
    return formatDateForSubmit(val)
  }
  if (f.type === 'relationship') {
    return normalizeRelationshipValue(val, f.hasMany)
  }
  if (f.type === 'upload') {
    return extractIdFromItem(val) ?? (val === null || val === '' ? null : val)
  }
  return formatNestedValueForSubmit(f, val)
}

export function formatDocForSubmit(
  fields: readonly ClientField[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const formatted = { ...data }
  for (const f of fields) {
    if (f.name in formatted) {
      formatted[f.name] = formatFieldValueForSubmit(f, formatted[f.name])
    }
  }
  return sanitizeConditionalFields(fields, formatted)
}

function getExplicitDefault(f: ClientField): unknown {
  if ('defaultValue' in f && f.defaultValue !== undefined) {
    return f.type === 'date' ? formatDateForInput(f.defaultValue) : f.defaultValue
  }
  return undefined
}

function getArrayFieldDefault(f: ClientArrayField): Array<Record<string, unknown>> {
  const minRows = f.minRows ?? (f.required ? 1 : 0)
  if (minRows <= 0) return []
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < minRows; i++) {
    rows.push({
      ...computeDefaultValues(f.fields),
      id: generateRowId(),
    })
  }
  return rows
}

export function getFieldDefault(f: ClientField): unknown {
  if (f.type === 'group') {
    const subDefaults = computeDefaultValues(f.fields)
    return Object.keys(subDefaults).length > 0 ? subDefaults : undefined
  }
  if (f.type === 'blocks') {
    return []
  }
  if (f.type === 'array') {
    return getArrayFieldDefault(f)
  }
  const explicit = getExplicitDefault(f)
  if (explicit !== undefined) {
    return explicit
  }
  if (f.type === 'checkbox') return false
  if (f.type === 'relationship' && f.hasMany) return []
  return undefined
}

export function computeDefaultValues(fields: readonly ClientField[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const f of fields) {
    const val = getFieldDefault(f)
    if (val !== undefined) {
      defaults[f.name] = val
    }
  }
  return defaults
}
