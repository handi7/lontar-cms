import {
  flattenFields,
  generateRowId,
  type Block,
  type Field,
  type Fields,
  type GroupField,
  type LocalizationConfig,
  type StoredDoc,
} from '@lontar/core'
import { getLocaleCodes } from './schema/table'

export interface ResolvedLocaleContext {
  requestedLocale?: string
  isAll: boolean
  fallbackLocale?: string
  allLocales: readonly string[]
  defaultLocale?: string
}

export function resolveLocaleContext(
  localization: LocalizationConfig | undefined,
  locale?: string,
  fallbackLocale?: string | false,
): ResolvedLocaleContext {
  if (!localization) {
    return {
      requestedLocale: locale,
      isAll: locale === 'all',
      fallbackLocale: undefined,
      allLocales: [],
      defaultLocale: undefined,
    }
  }
  const allLocales = getLocaleCodes(localization)
  const defaultLocale = localization.defaultLocale
  const requested = locale ?? defaultLocale
  const isAll = requested === 'all'

  let fbLocale: string | undefined = undefined
  if (
    !isAll &&
    fallbackLocale !== false &&
    fallbackLocale !== 'none' &&
    localization.fallback !== false
  ) {
    fbLocale = typeof fallbackLocale === 'string' ? fallbackLocale : defaultLocale
  }

  return {
    requestedLocale: requested,
    isAll,
    fallbackLocale: fbLocale,
    allLocales,
    defaultLocale,
  }
}

function isRichTextEmpty(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return obj.type === 'doc' && Array.isArray(obj.content) && obj.content.length === 0
}

export function isEmptyForFallback(value: unknown, field?: Field): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  if (field?.type === 'richText' || typeof value === 'object') {
    return isRichTextEmpty(value)
  }
  return false
}

function parseCoordinate(val: unknown): number | null {
  if (val === null || val === undefined) return null
  const num = Number(val)
  return Number.isNaN(num) ? null : num
}

function extractCoordinates(val: unknown): [number | null, number | null] | null {
  if (val === null) return [null, null]
  if (Array.isArray(val) && val.length === 2) {
    return [parseCoordinate(val[0]), parseCoordinate(val[1])]
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    const lng = obj.lng ?? obj.longitude
    const lat = obj.lat ?? obj.latitude
    return [parseCoordinate(lng), parseCoordinate(lat)]
  }
  return null
}

export function flattenPointValue(val: unknown, colName: string): Record<string, unknown> {
  const coords = extractCoordinates(val)
  if (!coords) return {}
  return {
    [`${colName}__lng`]: coords[0],
    [`${colName}__lat`]: coords[1],
  }
}

function extractPointFromRow(
  row: Record<string, unknown>,
  colLng: string,
  colLat: string,
): [number, number] | null {
  const lng = row[colLng]
  const lat = row[colLat]
  if ((lng === null || lng === undefined) && (lat === null || lat === undefined)) {
    return null
  }
  return [Number(lng), Number(lat)]
}

function extractRawValue(row: Record<string, unknown>, colName: string): unknown {
  const val = row[colName]
  return val instanceof Date ? val.toISOString() : (val ?? null)
}

function resolveLocalizedScalar(
  row: Record<string, unknown>,
  colName: string,
  field: Field,
  localeCtx: ResolvedLocaleContext,
): unknown {
  if (localeCtx.isAll) {
    const dict: Record<string, unknown> = {}
    for (const loc of localeCtx.allLocales) {
      dict[loc] = extractRawValue(row, `${colName}_${loc}`)
    }
    return dict
  }

  const requestedLoc = localeCtx.requestedLocale
  let val = requestedLoc ? extractRawValue(row, `${colName}_${requestedLoc}`) : null
  if (
    isEmptyForFallback(val, field) &&
    localeCtx.fallbackLocale &&
    localeCtx.fallbackLocale !== requestedLoc
  ) {
    val = extractRawValue(row, `${colName}_${localeCtx.fallbackLocale}`)
  }
  return val
}

function parseJsonValue(val: unknown): unknown {
  if (val === '' || val === null || val === undefined) return null
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as unknown
    } catch {
      return null
    }
  }
  return val
}

function resolveFallbackValue(
  d: Record<string, unknown>,
  field: Field,
  localeCtx: ResolvedLocaleContext,
): unknown {
  const req = localeCtx.requestedLocale
  let val = req ? d[req] : undefined
  if (
    isEmptyForFallback(val, field) &&
    localeCtx.fallbackLocale &&
    localeCtx.fallbackLocale !== req
  ) {
    val = d[localeCtx.fallbackLocale]
  }
  return val ?? null
}

function getSubfieldLocaleValue(
  loc: string,
  val: unknown,
  existing: Record<string, unknown> | null,
  defaultLoc: string | undefined,
): unknown {
  if (existing && loc in existing) {
    return existing[loc]
  }
  if (!existing && loc === defaultLoc && val !== undefined && val !== null) {
    return val
  }
  return null
}

function formatSubfieldAllLocales(
  val: unknown,
  localeCtx: ResolvedLocaleContext,
): Record<string, unknown> {
  const dict: Record<string, unknown> = {}
  const isObject = typeof val === 'object' && val !== null && !Array.isArray(val)
  const existing = isObject ? (val as Record<string, unknown>) : null
  const defaultLoc = localeCtx.defaultLocale ?? localeCtx.allLocales[0]
  for (const loc of localeCtx.allLocales) {
    dict[loc] = getSubfieldLocaleValue(loc, val, existing, defaultLoc)
  }
  return dict
}

function projectLocalizedSubfield(
  val: unknown,
  field: Field,
  localeCtx: ResolvedLocaleContext,
): unknown {
  if (localeCtx.isAll) {
    return formatSubfieldAllLocales(val, localeCtx)
  }
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return resolveFallbackValue(val as Record<string, unknown>, field, localeCtx)
  }
  return val === undefined ? null : val
}

function projectSingleSubfield(
  val: unknown,
  field: Field,
  localeCtx: ResolvedLocaleContext,
): unknown {
  if (field.type === 'group' && val && typeof val === 'object' && !Array.isArray(val)) {
    return projectJsonSubfields(val as Record<string, unknown>, field.fields, localeCtx)
  }
  if (field.localized) {
    return projectLocalizedSubfield(val, field, localeCtx)
  }
  return val
}

function projectJsonSubfields(
  item: Record<string, unknown>,
  fields: Fields,
  localeCtx: ResolvedLocaleContext,
): Record<string, unknown> {
  const projected = { ...item }
  for (const [name, field] of Object.entries(fields)) {
    projected[name] = projectSingleSubfield(projected[name], field, localeCtx)
  }
  return projected
}

function findBlockDef(blocks: readonly Block[], blockType: string): Block | undefined {
  return blocks.find((b) => b.slug === blockType)
}

function projectJsonArray(
  arr: unknown[],
  fields: Fields | readonly Block[],
  localeCtx: ResolvedLocaleContext,
): unknown[] {
  const isBlocks = Array.isArray(fields)
  return arr.map((item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const obj = item as Record<string, unknown>
    if (isBlocks) {
      const block = findBlockDef(fields as readonly Block[], String(obj.blockType))
      return block ? projectJsonSubfields(obj, block.fields, localeCtx) : obj
    }
    return projectJsonSubfields(obj, fields as Fields, localeCtx)
  })
}

function resolveLocalizedJsonArray(
  row: Record<string, unknown>,
  colName: string,
  field: Field,
  localeCtx: ResolvedLocaleContext,
): unknown {
  if (localeCtx.isAll) {
    const dict: Record<string, unknown> = {}
    for (const loc of localeCtx.allLocales) {
      dict[loc] = parseJsonValue(row[`${colName}_${loc}`])
    }
    return dict
  }
  const req = localeCtx.requestedLocale
  let val = parseJsonValue(req ? row[`${colName}_${req}`] : null)
  if (
    isEmptyForFallback(val, field) &&
    localeCtx.fallbackLocale &&
    localeCtx.fallbackLocale !== req
  ) {
    val = parseJsonValue(row[`${colName}_${localeCtx.fallbackLocale}`])
  }
  return val
}

function resolveJsonArrayValue(
  row: Record<string, unknown>,
  colName: string,
  field: Field,
  localeCtx: ResolvedLocaleContext,
): unknown {
  if (field.localized && localeCtx.allLocales.length > 0) {
    return resolveLocalizedJsonArray(row, colName, field, localeCtx)
  }

  const rawJson = parseJsonValue(row[colName])
  if (!Array.isArray(rawJson)) return rawJson
  const subFields = field.type === 'blocks' ? field.blocks : (field as { fields: Fields }).fields
  return projectJsonArray(rawJson, subFields, localeCtx)
}

function resolveScalarFieldValue(
  row: Record<string, unknown>,
  colName: string,
  field: Field,
  localeCtx: ResolvedLocaleContext,
  isFieldLocalized: boolean,
): { value: unknown; hasValue: boolean } {
  const val =
    isFieldLocalized && localeCtx.allLocales.length > 0
      ? resolveLocalizedScalar(row, colName, field, localeCtx)
      : extractRawValue(row, colName)
  return { value: val, hasValue: val !== null && val !== undefined }
}

function resolveJsonFieldValue(
  row: Record<string, unknown>,
  colName: string,
  field: Field,
  localeCtx: ResolvedLocaleContext,
  isFieldLocalized: boolean,
): { value: unknown; hasValue: boolean } {
  if (isFieldLocalized && localeCtx.allLocales.length > 0) {
    const val = resolveLocalizedJsonArray(row, colName, field, localeCtx)
    return { value: val, hasValue: val !== null && val !== undefined }
  }
  const val = parseJsonValue(row[colName])
  return { value: val, hasValue: val !== null && val !== undefined }
}

function resolvePointFieldValue(
  row: Record<string, unknown>,
  colName: string,
  _field: Field,
  localeCtx: ResolvedLocaleContext,
  isFieldLocalized: boolean,
): { value: unknown; hasValue: boolean } {
  if (isFieldLocalized && localeCtx.allLocales.length > 0) {
    if (localeCtx.isAll) {
      const dict: Record<string, unknown> = {}
      for (const loc of localeCtx.allLocales) {
        dict[loc] = extractPointFromRow(row, `${colName}__lng_${loc}`, `${colName}__lat_${loc}`)
      }
      return { value: dict, hasValue: true }
    }
    const req = localeCtx.requestedLocale
    let val = req
      ? extractPointFromRow(row, `${colName}__lng_${req}`, `${colName}__lat_${req}`)
      : null
    if (val === null && localeCtx.fallbackLocale && localeCtx.fallbackLocale !== req) {
      val = extractPointFromRow(
        row,
        `${colName}__lng_${localeCtx.fallbackLocale}`,
        `${colName}__lat_${localeCtx.fallbackLocale}`,
      )
    }
    return { value: val, hasValue: val !== null }
  }
  const val = extractPointFromRow(row, `${colName}__lng`, `${colName}__lat`)
  return { value: val, hasValue: val !== null }
}

function resolveFieldValue(
  row: Record<string, unknown>,
  colName: string,
  field: Field,
  localeCtx: ResolvedLocaleContext,
  parentLocalized = false,
): { value: unknown; hasValue: boolean } {
  const isFieldLocalized = Boolean(parentLocalized || field.localized)
  if (field.type === 'group') {
    const nested = projectGroup(row, colName, field, localeCtx, isFieldLocalized)
    return { value: nested, hasValue: nested !== null }
  }
  if (field.type === 'point') {
    return resolvePointFieldValue(row, colName, field, localeCtx, isFieldLocalized)
  }
  if (field.type === 'relationship' && field.hasMany) {
    return { value: undefined, hasValue: false }
  }
  if (field.type === 'array' || field.type === 'blocks') {
    const jsonVal = resolveJsonArrayValue(row, colName, field, localeCtx)
    return { value: jsonVal, hasValue: jsonVal !== null }
  }
  if (field.type === 'json') {
    return resolveJsonFieldValue(row, colName, field, localeCtx, isFieldLocalized)
  }
  return resolveScalarFieldValue(row, colName, field, localeCtx, isFieldLocalized)
}

function projectGroup(
  row: Record<string, unknown>,
  prefix: string,
  groupField: GroupField,
  localeCtx: ResolvedLocaleContext,
  parentLocalized = false,
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}
  let hasAnyNonNull = false
  const isLocalized = Boolean(parentLocalized || groupField.localized)
  for (const [subName, subField] of Object.entries(groupField.fields)) {
    const colName = `${prefix}__${subName}`
    const { value, hasValue } = resolveFieldValue(row, colName, subField, localeCtx, isLocalized)
    result[subName] = value
    if (hasValue) {
      hasAnyNonNull = true
    }
  }
  if (!hasAnyNonNull && !groupField.required) {
    return null
  }
  return result
}

const SYSTEM_FIELDS_TO_PRESERVE = new Set([
  'id',
  'createdAt',
  'updatedAt',
  '_status',
  'filename',
  'url',
  'mimeType',
  'filesize',
  'width',
  'height',
  'sizes',
])

function convertSystemField(key: string, value: unknown): unknown {
  if (key === 'id') return Number(value)
  if (key === 'createdAt' || key === 'updatedAt') {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') return value
    return ''
  }
  return value instanceof Date ? value.toISOString() : value
}

export function projectStoredDoc(
  row: Record<string, unknown>,
  fields: Fields | undefined,
  localeCtx: ResolvedLocaleContext,
): StoredDoc {
  if (!fields) {
    return row as StoredDoc
  }
  const flatFields = flattenFields(fields)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (SYSTEM_FIELDS_TO_PRESERVE.has(key)) {
      result[key] = convertSystemField(key, value)
    }
  }
  for (const [fieldName, field] of Object.entries(flatFields)) {
    const { value } = resolveFieldValue(row, fieldName, field, localeCtx)
    if (value !== undefined) {
      result[fieldName] = value
    }
  }
  return result as StoredDoc
}

function normalizeDateString(str: string): string {
  const trimmed = str.trim()
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`
  }
  return trimmed
}

export function sanitizeDate(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value === 'string') {
    return new Date(normalizeDateString(value))
  }
  return value
}

export function sanitizeRichText(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

export function sanitizeRelationship(field: Field | undefined, value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (field?.type === 'relationship' && field.hasMany) {
    if (Array.isArray(value)) {
      return value.map((v) => Number(v)).filter((n) => !Number.isNaN(n))
    }
    return []
  }
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

export function sanitizeFieldValue(field: Field | undefined, value: unknown): unknown {
  if (!field) return value
  switch (field.type) {
    case 'date':
      return sanitizeDate(value)
    case 'richText':
      return sanitizeRichText(value)
    case 'relationship':
      return sanitizeRelationship(field, value)
    default:
      return value
  }
}

function mergeSubfieldValue(
  existingDict: unknown,
  subVal: unknown,
  subField: Field,
  localeCtx: ResolvedLocaleContext,
): unknown {
  const sanitized = sanitizeFieldValue(subField, subVal)
  if (localeCtx.isAll) {
    return sanitized
  }
  const loc = localeCtx.requestedLocale
  if (!loc) return sanitized
  const baseDict =
    existingDict && typeof existingDict === 'object' && !Array.isArray(existingDict)
      ? (existingDict as Record<string, unknown>)
      : {}
  return {
    ...baseDict,
    [loc]: sanitized,
  }
}

function processNestedGroupSubfield(
  result: Record<string, unknown>,
  existingItem: Record<string, unknown> | undefined,
  subName: string,
  subField: GroupField,
  localeCtx: ResolvedLocaleContext,
): void {
  const nested = result[subName]
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const existingNested = existingItem?.[subName] as Record<string, unknown> | undefined
    result[subName] = processItemSubfields(
      nested as Record<string, unknown>,
      existingNested,
      subField.fields,
      localeCtx,
    )
  }
}

function processNestedContainerSubfield(
  result: Record<string, unknown>,
  existingItem: Record<string, unknown> | undefined,
  subName: string,
  subField: Field,
  localeCtx: ResolvedLocaleContext,
): void {
  const subSubFields =
    subField.type === 'blocks' ? subField.blocks : (subField as { fields: Fields }).fields
  const existingArr = existingItem?.[subName]
  result[subName] = processContainerItems(result[subName], subSubFields, localeCtx, existingArr)
}

function processSubfieldEntry(
  result: Record<string, unknown>,
  existingItem: Record<string, unknown> | undefined,
  subName: string,
  subField: Field,
  localeCtx: ResolvedLocaleContext,
): void {
  if (subField.type === 'group') {
    processNestedGroupSubfield(result, existingItem, subName, subField, localeCtx)
  } else if (subField.type === 'array' || subField.type === 'blocks') {
    processNestedContainerSubfield(result, existingItem, subName, subField, localeCtx)
  } else if (subField.localized && localeCtx.allLocales.length > 0) {
    result[subName] = mergeSubfieldValue(
      existingItem?.[subName],
      result[subName],
      subField,
      localeCtx,
    )
  } else {
    result[subName] = sanitizeFieldValue(subField, result[subName])
  }
}

function processItemSubfields(
  item: Record<string, unknown>,
  existingItem: Record<string, unknown> | undefined,
  fields: Fields,
  localeCtx: ResolvedLocaleContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...item }
  if (!result.id) {
    result.id = generateRowId()
  }
  for (const [subName, subField] of Object.entries(fields)) {
    if (subName in result) {
      processSubfieldEntry(result, existingItem, subName, subField, localeCtx)
    }
  }
  return result
}

export function processContainerItems(
  items: unknown,
  fields: Fields | readonly Block[],
  localeCtx: ResolvedLocaleContext,
  existingItems?: unknown,
): unknown[] | null {
  const arr = parseJsonValue(items)
  if (!Array.isArray(arr)) return null
  const existingArr: unknown[] = Array.isArray(existingItems) ? existingItems : []
  const isBlocks = Array.isArray(fields)

  return arr.map((item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const obj = item as Record<string, unknown>
    const existingObj = existingArr.find(
      (x) =>
        x &&
        typeof x === 'object' &&
        !Array.isArray(x) &&
        (x as Record<string, unknown>).id === obj.id,
    ) as Record<string, unknown> | undefined

    if (isBlocks) {
      const blockDef = findBlockDef(fields as readonly Block[], String(obj.blockType))
      return blockDef ? processItemSubfields(obj, existingObj, blockDef.fields, localeCtx) : obj
    }
    return processItemSubfields(obj, existingObj, fields as Fields, localeCtx)
  })
}

function sanitizeScalarAllLocales(
  clean: Record<string, unknown>,
  key: string,
  field: Field,
  value: unknown,
  localeCtx: ResolvedLocaleContext,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  for (const [loc, locVal] of Object.entries(value as Record<string, unknown>)) {
    if (localeCtx.allLocales.includes(loc)) {
      clean[`${key}_${loc}`] = sanitizeFieldValue(field, locVal)
    }
  }
}

function sanitizeLocalizedScalarField(
  clean: Record<string, unknown>,
  key: string,
  field: Field,
  value: unknown,
  localeCtx: ResolvedLocaleContext,
): void {
  if (localeCtx.isAll) {
    sanitizeScalarAllLocales(clean, key, field, value, localeCtx)
    return
  }
  const loc = localeCtx.requestedLocale
  if (loc) {
    clean[`${key}_${loc}`] = sanitizeFieldValue(field, value)
  }
}

function sanitizeLocalizedContainerField(
  clean: Record<string, unknown>,
  key: string,
  field: Field,
  value: unknown,
  localeCtx: ResolvedLocaleContext,
): void {
  const subFields = field.type === 'blocks' ? field.blocks : (field as { fields: Fields }).fields
  if (localeCtx.isAll) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [loc, locVal] of Object.entries(value as Record<string, unknown>)) {
        if (localeCtx.allLocales.includes(loc)) {
          clean[`${key}_${loc}`] = processContainerItems(locVal, subFields, localeCtx)
        }
      }
    }
    return
  }
  const loc = localeCtx.requestedLocale
  if (loc) {
    clean[`${key}_${loc}`] = processContainerItems(value, subFields, localeCtx)
  }
}

function clearGroupFields(
  clean: Record<string, unknown>,
  fields: Fields,
  localeCtx: ResolvedLocaleContext,
  prefix: string,
  parentLocalized: boolean,
): void {
  for (const [subKey, subField] of Object.entries(fields)) {
    const fullCol = resolveFullKey(prefix, subKey)
    const isLoc = Boolean(parentLocalized || subField.localized)
    if (subField.type === 'group') {
      clearGroupFields(clean, subField.fields, localeCtx, fullCol, isLoc)
    } else if (isLoc) {
      if (localeCtx.isAll) {
        for (const loc of localeCtx.allLocales) {
          clean[`${fullCol}_${loc}`] = null
        }
      } else if (localeCtx.requestedLocale) {
        clean[`${fullCol}_${localeCtx.requestedLocale}`] = null
      }
    } else {
      clean[fullCol] = null
    }
  }
}

function sanitizeGroupField(
  clean: Record<string, unknown>,
  key: string,
  field: GroupField,
  value: unknown,
  localeCtx: ResolvedLocaleContext,
  existingDoc: Record<string, unknown> | undefined,
  fullKey: string,
  isLoc: boolean,
): void {
  if (value === null) {
    clearGroupFields(clean, field.fields, localeCtx, fullKey, isLoc)
    return
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const existingGroup = existingDoc?.[key] as Record<string, unknown> | undefined
    sanitizeEntries(
      clean,
      field.fields,
      value as Record<string, unknown>,
      localeCtx,
      existingGroup,
      fullKey,
      isLoc,
    )
  }
}

function sanitizeLocalizedField(
  clean: Record<string, unknown>,
  fullKey: string,
  field: Field,
  value: unknown,
  localeCtx: ResolvedLocaleContext,
): void {
  if (field.type === 'array' || field.type === 'blocks') {
    sanitizeLocalizedContainerField(clean, fullKey, field, value, localeCtx)
  } else {
    sanitizeLocalizedScalarField(clean, fullKey, field, value, localeCtx)
  }
}

function sanitizeStandardField(
  clean: Record<string, unknown>,
  fullKey: string,
  field: Field,
  value: unknown,
  localeCtx: ResolvedLocaleContext,
  existingVal?: unknown,
): void {
  if (field.type === 'array' || field.type === 'blocks') {
    const subFields = field.type === 'blocks' ? field.blocks : field.fields
    clean[fullKey] = processContainerItems(value, subFields, localeCtx, existingVal)
    return
  }
  clean[fullKey] = sanitizeFieldValue(field, value)
}

function resolveFullKey(prefix: string, key: string): string {
  return prefix ? `${prefix}__${key}` : key
}

function shouldSkipField(field?: Field): boolean {
  return Boolean(field?.type === 'relationship' && field.hasMany)
}

function sanitizePointField(
  clean: Record<string, unknown>,
  fullKey: string,
  _field: Field,
  value: unknown,
  localeCtx: ResolvedLocaleContext,
  isLocalized: boolean,
): void {
  if (!isLocalized || localeCtx.allLocales.length === 0) {
    Object.assign(clean, flattenPointValue(value, fullKey))
    return
  }
  if (localeCtx.isAll) {
    if (!value || typeof value !== 'object') return
    const dict = value as Record<string, unknown>
    for (const loc of localeCtx.allLocales) {
      if (loc in dict) {
        const pt = dict[loc]
        const flat = flattenPointValue(pt, fullKey)
        clean[`${fullKey}__lng_${loc}`] = flat[`${fullKey}__lng`]
        clean[`${fullKey}__lat_${loc}`] = flat[`${fullKey}__lat`]
      }
    }
    return
  }
  const loc = localeCtx.requestedLocale
  if (loc) {
    const flat = flattenPointValue(value, fullKey)
    clean[`${fullKey}__lng_${loc}`] = flat[`${fullKey}__lng`]
    clean[`${fullKey}__lat_${loc}`] = flat[`${fullKey}__lat`]
  }
}

function sanitizeFieldEntry(
  clean: Record<string, unknown>,
  fields: Fields,
  key: string,
  value: unknown,
  localeCtx: ResolvedLocaleContext,
  existingDoc: Record<string, unknown> | undefined,
  prefix: string,
  parentLocalized: boolean,
): void {
  const field = fields[key]
  if (!field) {
    clean[key] = value
    return
  }
  if (shouldSkipField(field)) return
  const fullKey = resolveFullKey(prefix, key)
  const isLoc = parentLocalized || Boolean(field.localized)

  if (field.type === 'group') {
    sanitizeGroupField(clean, key, field, value, localeCtx, existingDoc, fullKey, isLoc)
    return
  }
  if (field.type === 'point') {
    sanitizePointField(clean, fullKey, field, value, localeCtx, isLoc)
    return
  }
  if (isLoc && localeCtx.allLocales.length > 0) {
    sanitizeLocalizedField(clean, fullKey, field, value, localeCtx)
    return
  }
  sanitizeStandardField(clean, fullKey, field, value, localeCtx, existingDoc?.[key])
}

function sanitizeEntries(
  clean: Record<string, unknown>,
  fields: Fields,
  data: Record<string, unknown>,
  localeCtx: ResolvedLocaleContext,
  existingDoc: Record<string, unknown> | undefined,
  prefix: string,
  parentLocalized: boolean,
): void {
  for (const [key, value] of Object.entries(data)) {
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue
    sanitizeFieldEntry(clean, fields, key, value, localeCtx, existingDoc, prefix, parentLocalized)
  }
}

export function sanitizeDataWithLocale(
  fields: Fields,
  data: Record<string, unknown>,
  localeCtx: ResolvedLocaleContext,
  existingDoc?: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  sanitizeEntries(clean, flattenFields(fields), data, localeCtx, existingDoc, '', false)
  return clean
}
