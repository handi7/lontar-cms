import {
  flattenClientFields,
  generateRowId,
  sanitizeConditionalFields,
  type ClientArrayField,
  type ClientCollapsibleField,
  type ClientField,
  type ClientRowField,
  type ClientTabsField,
  type FieldPermission,
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

function normalizePolymorphicEntry(item: unknown): { relationTo: string; value: number } | null {
  if (!item || typeof item !== 'object') return null
  const rec = item as Record<string, unknown>
  if (typeof rec.relationTo !== 'string' || !rec.relationTo) return null
  const id = extractIdFromItem(rec.value)
  if (id === null) return null
  return { relationTo: rec.relationTo, value: id }
}

function normalizePolymorphicSingle(val: unknown, preserveNullValue: boolean): unknown {
  if (val === null || val === undefined) return val
  if (typeof val !== 'object') return null
  const rec = val as Record<string, unknown>
  if (typeof rec.relationTo !== 'string' || !rec.relationTo) return null
  if (rec.value === null) {
    return preserveNullValue ? { relationTo: rec.relationTo, value: null } : null
  }
  const id = extractIdFromItem(rec.value)
  return id !== null ? { relationTo: rec.relationTo, value: id } : null
}

function normalizePolymorphicValue(
  val: unknown,
  hasMany?: boolean,
  preserveNullValue = false,
): unknown {
  if (hasMany) {
    if (!Array.isArray(val)) return []
    return (val as unknown[])
      .map(normalizePolymorphicEntry)
      .filter((entry): entry is { relationTo: string; value: number } => entry !== null)
  }
  return normalizePolymorphicSingle(val, preserveNullValue)
}

export function normalizeRelationshipValue(
  val: unknown,
  hasMany?: boolean,
  polymorphic = false,
): unknown {
  if (polymorphic) {
    return normalizePolymorphicValue(val, hasMany, false)
  }
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
    return Array.isArray(f.relationTo)
      ? normalizePolymorphicValue(val, f.hasMany, true)
      : normalizeRelationshipValue(val, f.hasMany)
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
  for (const f of flattenClientFields(fields)) {
    if (f.name in formatted) {
      formatted[f.name] = formatFieldForForm(f, formatted[f.name])
    }
  }
  return formatted
}

export const EXCLUDED_SUBMIT_SYSTEM_FIELDS = [
  'createdAt',
  'updatedAt',
  '_status',
  '_isPublished',
  'latestVersionId',
] as const

function formatNestedValueForSubmit(f: ClientField, val: unknown): unknown {
  if (f.type === 'group' && val && typeof val === 'object') {
    return formatDocForSubmit(f.fields, val as Record<string, unknown>, false)
  }
  if (f.type === 'array' && Array.isArray(val)) {
    const rows = val as readonly unknown[]
    return rows.map((row) =>
      row && typeof row === 'object'
        ? formatDocForSubmit(f.fields, row as Record<string, unknown>, false)
        : row,
    )
  }
  if (f.type === 'blocks' && Array.isArray(val)) {
    const rows = val as readonly unknown[]
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row
      const record = row as Record<string, unknown>
      const blockDef = f.blocks.find((b) => b.slug === record.blockType)
      return blockDef ? formatDocForSubmit(blockDef.fields, record, false) : record
    })
  }
  return val
}

function formatFieldValueForSubmit(f: ClientField, val: unknown): unknown {
  if (f.type === 'date') {
    return formatDateForSubmit(val)
  }
  if (f.type === 'relationship') {
    return normalizeRelationshipValue(val, f.hasMany, Array.isArray(f.relationTo))
  }
  if (f.type === 'upload') {
    return extractIdFromItem(val) ?? (val === null || val === '' ? null : val)
  }
  return formatNestedValueForSubmit(f, val)
}

export function formatDocForSubmit(
  fields: readonly ClientField[],
  data: Record<string, unknown>,
  isRoot: boolean = true,
  permissions?: Record<string, FieldPermission>,
  mode: 'create' | 'edit' = 'edit',
): Record<string, unknown> {
  const flatFields = flattenClientFields(fields)
  const formatted = { ...data }
  if (isRoot) {
    delete formatted.id
  }
  for (const sysField of EXCLUDED_SUBMIT_SYSTEM_FIELDS) {
    delete formatted[sysField]
  }
  for (const f of flatFields) {
    if (f.name in formatted) {
      formatted[f.name] = formatFieldValueForSubmit(f, formatted[f.name])
    }
  }
  const sanitized = sanitizeConditionalFields(flatFields, formatted)
  if (permissions) {
    return stripReadOnlyFields(flatFields, sanitized, permissions, mode)
  }
  return sanitized
}

export function isFieldReadOnly(
  fieldPerm: FieldPermission | undefined,
  mode: 'create' | 'edit' = 'edit',
  readOnlyDoc?: boolean,
): boolean {
  if (readOnlyDoc) return true
  if (!fieldPerm) return false
  return mode === 'create' ? fieldPerm.create === false : fieldPerm.update === false
}

export function isFieldVisible(fieldPerm: FieldPermission | undefined): boolean {
  if (!fieldPerm) return true
  return fieldPerm.read !== false
}

function stripNestedReadOnly(
  f: ClientField,
  val: unknown,
  perm: FieldPermission,
  mode: 'create' | 'edit',
): unknown {
  if (f.type === 'group' && val && typeof val === 'object' && !Array.isArray(val)) {
    return stripReadOnlyFromObject(f.fields, val as Record<string, unknown>, perm.fields, mode)
  }
  if (f.type === 'array' && Array.isArray(val)) {
    return (val as Array<Record<string, unknown>>).map((row) =>
      row && typeof row === 'object'
        ? stripReadOnlyFromObject(f.fields, row, perm.fields, mode)
        : row,
    )
  }
  if (f.type === 'blocks' && Array.isArray(val)) {
    return (val as Array<Record<string, unknown>>).map((row) => {
      if (!row || typeof row !== 'object') return row
      const blockDef = f.blocks.find((b) => b.slug === row.blockType)
      const blockPerms = perm.blocks?.[row.blockType as string]?.fields
      return blockDef ? stripReadOnlyFromObject(blockDef.fields, row, blockPerms, mode) : row
    })
  }
  return val
}

function stripReadOnlyFromObject(
  fields: readonly ClientField[],
  data: Record<string, unknown>,
  permissions?: Record<string, FieldPermission>,
  mode: 'create' | 'edit' = 'edit',
): Record<string, unknown> {
  if (!permissions) return data
  const formatted = { ...data }
  for (const f of flattenClientFields(fields)) {
    if (!(f.name in formatted)) continue
    const perm = permissions[f.name]
    if (!perm) continue

    if (isFieldReadOnly(perm, mode)) {
      delete formatted[f.name]
      continue
    }

    formatted[f.name] = stripNestedReadOnly(f, formatted[f.name], perm, mode)
  }
  return formatted
}

export function stripReadOnlyFields(
  fields: readonly ClientField[],
  data: Record<string, unknown>,
  permissions?: Record<string, FieldPermission>,
  mode: 'create' | 'edit' = 'edit',
): Record<string, unknown> {
  return stripReadOnlyFromObject(fields, data, permissions, mode)
}

function mapSubfieldPermissions(f: ClientField, perm: FieldPermission | undefined): ClientField {
  if (f.type === 'group') {
    return {
      ...f,
      fields: filterReadableFields(f.fields, perm?.fields),
    }
  }
  if (f.type === 'array') {
    return {
      ...f,
      fields: filterReadableFields(f.fields, perm?.fields),
    }
  }
  if (f.type === 'blocks') {
    return {
      ...f,
      blocks: f.blocks.map((b) => ({
        ...b,
        fields: filterReadableFields(b.fields, perm?.blocks?.[b.slug]?.fields),
      })),
    }
  }
  return f
}

function filterReadableLayoutField(
  f: ClientTabsField | ClientRowField | ClientCollapsibleField,
  permissions: Record<string, FieldPermission>,
): ClientField | null {
  if (f.type === 'tabs') {
    const tabs = f.tabs
      .map((tab) => ({ ...tab, fields: filterReadableFields(tab.fields, permissions) }))
      .filter((tab) => tab.fields.length > 0)
    return tabs.length > 0 ? { ...f, tabs } : null
  }
  const fields = filterReadableFields(f.fields, permissions)
  return fields.length > 0 ? { ...f, fields } : null
}

export function filterReadableFields(
  fields: readonly ClientField[],
  permissions?: Record<string, FieldPermission>,
): ClientField[] {
  if (!permissions) return [...fields]
  const result: ClientField[] = []
  for (const f of fields) {
    if (f.type === 'tabs' || f.type === 'row' || f.type === 'collapsible') {
      const filtered = filterReadableLayoutField(f, permissions)
      if (filtered) result.push(filtered)
      continue
    }
    const perm = permissions[f.name]
    if (perm?.read === false) continue
    result.push(mapSubfieldPermissions(f, perm))
  }
  return result
}

function makeFieldOptionalForValidation(field: ClientField): ClientField {
  if (field.type === 'array' || field.type === 'blocks') {
    return { ...field, required: false, minRows: 0 }
  }
  return { ...field, required: false }
}

function mapSubfieldValidation(
  f: ClientField,
  perm: FieldPermission | undefined,
  mode: 'create' | 'edit',
  readOnlyDoc: boolean,
): ClientField {
  if (f.type === 'group') {
    return {
      ...f,
      fields: buildFormValidationFields(f.fields, perm?.fields, mode, readOnlyDoc),
    }
  }
  if (f.type === 'array') {
    return {
      ...f,
      fields: buildFormValidationFields(f.fields, perm?.fields, mode, readOnlyDoc),
    }
  }
  if (f.type === 'blocks') {
    return {
      ...f,
      blocks: f.blocks.map((b) => ({
        ...b,
        fields: buildFormValidationFields(
          b.fields,
          perm?.blocks?.[b.slug]?.fields,
          mode,
          readOnlyDoc,
        ),
      })),
    }
  }
  return f
}

function buildLayoutValidationField(
  f: ClientTabsField | ClientRowField | ClientCollapsibleField,
  permissions: Record<string, FieldPermission> | undefined,
  mode: 'create' | 'edit',
  readOnlyDoc: boolean,
): ClientField | null {
  if (f.type === 'tabs') {
    const tabs = f.tabs
      .map((tab) => ({
        ...tab,
        fields: buildFormValidationFields(tab.fields, permissions, mode, readOnlyDoc),
      }))
      .filter((tab) => tab.fields.length > 0)
    return tabs.length > 0 ? { ...f, tabs } : null
  }
  const fields = buildFormValidationFields(f.fields, permissions, mode, readOnlyDoc)
  return fields.length > 0 ? { ...f, fields } : null
}

function buildSingleValidationField(
  f: ClientField,
  permissions: Record<string, FieldPermission> | undefined,
  mode: 'create' | 'edit',
  readOnlyDoc: boolean,
): ClientField | null {
  if (f.type === 'tabs' || f.type === 'row' || f.type === 'collapsible') {
    return buildLayoutValidationField(f, permissions, mode, readOnlyDoc)
  }

  const perm = permissions?.[f.name]
  if (perm?.read === false) return null

  const isLocked = readOnlyDoc || isFieldReadOnly(perm, mode, readOnlyDoc)
  const withSubfields = mapSubfieldValidation(f, perm, mode, isLocked)
  return isLocked ? makeFieldOptionalForValidation(withSubfields) : withSubfields
}

export function buildFormValidationFields(
  fields: readonly ClientField[],
  permissions?: Record<string, FieldPermission>,
  mode: 'create' | 'edit' = 'edit',
  readOnlyDoc = false,
): ClientField[] {
  if (!permissions && !readOnlyDoc) return [...fields]

  const result: ClientField[] = []
  for (const f of fields) {
    const field = buildSingleValidationField(f, permissions, mode, readOnlyDoc)
    if (field) result.push(field)
  }
  return result
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

export function isSameDoc(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.id !== undefined && b.id !== undefined && a.id !== b.id) return false
  if (a.updatedAt && b.updatedAt) return a.updatedAt === b.updatedAt
  return false
}

export function computeDefaultValues(fields: readonly ClientField[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const f of flattenClientFields(fields)) {
    const val = getFieldDefault(f)
    if (val !== undefined) {
      defaults[f.name] = val
    }
  }
  return defaults
}
