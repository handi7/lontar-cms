import type { ClientField } from '@lontar/core/client'

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

export function formatFieldForForm(f: ClientField, val: unknown): unknown {
  if (f.type === 'date') {
    return formatDateForInput(val)
  }
  if (f.type === 'relationship') {
    return normalizeRelationshipValue(val, f.hasMany)
  }
  if (f.type === 'group') {
    if (!val || typeof val !== 'object') return val
    return formatDocForForm(f.fields, val as Record<string, unknown>)
  }
  return val
}

export function formatDocForForm(
  fields: readonly ClientField[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const formatted = { ...data }
  for (const f of fields) {
    if (f.name in formatted) {
      formatted[f.name] = formatFieldForForm(f, formatted[f.name])
    }
  }
  return formatted
}

export function formatDocForSubmit(
  fields: readonly ClientField[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const formatted = { ...data }
  for (const f of fields) {
    if (f.name in formatted) {
      if (f.type === 'date') {
        formatted[f.name] = formatDateForSubmit(formatted[f.name])
      } else if (f.type === 'group' && formatted[f.name] && typeof formatted[f.name] === 'object') {
        formatted[f.name] = formatDocForSubmit(
          f.fields,
          formatted[f.name] as Record<string, unknown>,
        )
      }
    }
  }
  return formatted
}

export function getFieldDefault(f: ClientField): unknown {
  if (f.type === 'group') {
    const subDefaults = computeDefaultValues(f.fields)
    return Object.keys(subDefaults).length > 0 ? subDefaults : undefined
  }
  if ('defaultValue' in f && f.defaultValue !== undefined) {
    if (f.type === 'date') {
      return formatDateForInput(f.defaultValue)
    }
    return f.defaultValue
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
