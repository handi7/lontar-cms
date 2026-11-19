import type { Config } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type { Block, Fields } from '../fields/types'
import { ValidationError } from './errors'

export function extractLocaleCodes(config: Config): string[] {
  if (!config.localization) return []
  return config.localization.locales.map((l) => (typeof l === 'string' ? l : l.code))
}

export function resolveOperationLocale(
  config: Config,
  locale?: string,
  fallbackLocale?: string | false,
): { locale?: string; fallbackLocale?: string | false } {
  const localization = config.localization
  if (!localization) {
    if (locale !== undefined && locale !== '') {
      throw new ValidationError('Validation failed', {
        issues: [{ path: 'locale', message: `Unknown locale "${locale}"` }],
      })
    }
    if (fallbackLocale !== undefined && fallbackLocale !== '') {
      throw new ValidationError('Validation failed', {
        issues: [
          {
            path: 'fallbackLocale',
            message: `Unknown fallback locale "${String(fallbackLocale)}"`,
          },
        ],
      })
    }
    return {}
  }

  const validCodes = extractLocaleCodes(config)
  const resolvedLocale = resolveRequestedLocale(locale, validCodes, localization.defaultLocale)
  const resolvedFallback = resolveRequestedFallback(fallbackLocale, validCodes)

  return { locale: resolvedLocale, fallbackLocale: resolvedFallback }
}

function resolveRequestedLocale(
  locale: string | undefined,
  validCodes: string[],
  defaultLocale: string,
): string {
  if (locale !== undefined && locale !== '') {
    if (locale !== 'all' && !validCodes.includes(locale)) {
      throw new ValidationError('Validation failed', {
        issues: [{ path: 'locale', message: `Unknown locale "${locale}"` }],
      })
    }
    return locale
  }
  return defaultLocale
}

function resolveRequestedFallback(
  fallbackLocale: string | false | undefined,
  validCodes: string[],
): string | false | undefined {
  if (fallbackLocale === undefined || fallbackLocale === '') {
    return undefined
  }
  if (fallbackLocale === false || fallbackLocale === 'false' || fallbackLocale === 'none') {
    return false
  }
  if (validCodes.includes(fallbackLocale)) {
    return fallbackLocale
  }
  throw new ValidationError('Validation failed', {
    issues: [
      { path: 'fallbackLocale', message: `Unknown fallback locale "${String(fallbackLocale)}"` },
    ],
  })
}

export interface ProjectLocaleContext {
  locale?: string
  fallbackLocale?: string | false
  defaultLocale?: string
  allLocales?: readonly string[]
}

interface CommonFieldInfo {
  name: string
  type: string
  localized?: boolean
  fields?: unknown
  blocks?: unknown
}

function isRichTextEmpty(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return obj.type === 'doc' && Array.isArray(obj.content) && obj.content.length === 0
}

export function isEmptyForFallback(value: unknown, field?: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  const f = field as { type?: string } | undefined
  if (f?.type === 'richText' || typeof value === 'object') {
    return isRichTextEmpty(value)
  }
  return false
}

function resolveFallbackLocale(ctx: ProjectLocaleContext): string | undefined {
  if (
    ctx.fallbackLocale === false ||
    ctx.fallbackLocale === 'false' ||
    ctx.fallbackLocale === 'none'
  ) {
    return undefined
  }
  return typeof ctx.fallbackLocale === 'string' ? ctx.fallbackLocale : ctx.defaultLocale
}

function shouldFallback(
  val: unknown,
  field: unknown,
  fbLocale?: string,
  reqLocale?: string,
): boolean {
  return Boolean(fbLocale && fbLocale !== reqLocale && isEmptyForFallback(val, field))
}

function projectLocalizedScalar(
  val: unknown,
  field: unknown,
  reqLocale: string,
  fbLocale?: string,
): unknown {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    return val ?? null
  }
  const dict = val as Record<string, unknown>
  let resolved = dict[reqLocale]
  if (shouldFallback(resolved, field, fbLocale, reqLocale) && fbLocale) {
    const fallbackVal = dict[fbLocale]
    if (fallbackVal !== undefined && !isEmptyForFallback(fallbackVal, field)) {
      resolved = fallbackVal
    }
  }
  return resolved ?? null
}

function projectLocalizedContainer(val: unknown, reqLocale: string, fbLocale?: string): unknown[] {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    return Array.isArray(val) ? val : []
  }
  const dict = val as Record<string, unknown>
  let resolved = dict[reqLocale]
  if (shouldFallback(resolved, undefined, fbLocale, reqLocale) && fbLocale) {
    const fallbackVal = dict[fbLocale]
    if (fallbackVal !== undefined && !isEmptyForFallback(fallbackVal)) {
      resolved = fallbackVal
    }
  }
  return Array.isArray(resolved) ? resolved : []
}

function findBlockDef(blocks: unknown, blockType: string): Block | undefined {
  if (!Array.isArray(blocks)) return undefined
  for (const b of blocks) {
    if (typeof b === 'object' && b !== null) {
      const candidate = b as { slug?: unknown; blockType?: unknown }
      if (candidate.slug === blockType || candidate.blockType === blockType) {
        return b as Block
      }
    }
  }
  return undefined
}

function projectSubfieldContainer(
  val: unknown,
  field: CommonFieldInfo,
  ctx: ProjectLocaleContext,
): unknown[] {
  if (!Array.isArray(val)) return []
  const arr = val as readonly unknown[]
  return arr.map((item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item
    if (field.type === 'blocks') {
      const blockDef = findBlockDef(
        field.blocks,
        String((item as Record<string, unknown>).blockType),
      )
      return blockDef ? projectCanonicalDoc(item as DocumentData, blockDef.fields, ctx) : item
    }
    return field.fields
      ? projectCanonicalDoc(item as DocumentData, field.fields as Fields, ctx)
      : item
  })
}

function projectFieldByType(
  val: unknown,
  field: CommonFieldInfo,
  ctx: ProjectLocaleContext,
): unknown {
  if (field.type === 'group' && field.fields) {
    return val && typeof val === 'object' && !Array.isArray(val)
      ? projectCanonicalDoc(val as DocumentData, field.fields as Fields, ctx)
      : val
  }
  if (field.type === 'array' || field.type === 'blocks') {
    return projectSubfieldContainer(val, field, ctx)
  }
  return val
}

function projectSingleField(
  val: unknown,
  field: CommonFieldInfo,
  ctx: ProjectLocaleContext,
  reqLocale: string,
  fbLocale?: string,
): unknown {
  if (field.localized) {
    return field.type === 'array' || field.type === 'blocks'
      ? projectLocalizedContainer(val, reqLocale, fbLocale)
      : projectLocalizedScalar(val, field, reqLocale, fbLocale)
  }
  return projectFieldByType(val, field, ctx)
}

function normalizeFieldList(fields: Fields | readonly unknown[]): CommonFieldInfo[] {
  if (Array.isArray(fields)) {
    const result: CommonFieldInfo[] = []
    for (const raw of fields) {
      if (raw && typeof raw === 'object' && 'name' in raw) {
        result.push(raw as CommonFieldInfo)
      }
    }
    return result
  }
  if (fields && typeof fields === 'object') {
    return Object.entries(fields).map(([name, raw]) => ({
      ...((raw && typeof raw === 'object' ? raw : {}) as CommonFieldInfo),
      name,
    }))
  }
  return []
}

export function projectCanonicalDoc(
  doc: DocumentData,
  fields: Fields | readonly unknown[],
  ctx: ProjectLocaleContext,
): DocumentData {
  if (!doc || typeof doc !== 'object') return doc
  if (!ctx.locale || ctx.locale === 'all') return doc

  const reqLocale = ctx.locale
  const fbLocale = resolveFallbackLocale(ctx)
  const fieldList = normalizeFieldList(fields)
  const projected: DocumentData = { ...doc }

  for (const field of fieldList) {
    if (field.name in doc) {
      projected[field.name] = projectSingleField(doc[field.name], field, ctx, reqLocale, fbLocale)
    }
  }

  return projected
}

function mergeLocalizedScalar(
  origVal: unknown,
  incomingVal: unknown,
  locale: string,
  defaultLocale?: string,
): Record<string, unknown> {
  const existingDict: Record<string, unknown> =
    origVal && typeof origVal === 'object' && !Array.isArray(origVal)
      ? { ...(origVal as Record<string, unknown>) }
      : {}
  if (
    Object.keys(existingDict).length === 0 &&
    origVal !== undefined &&
    origVal !== null &&
    defaultLocale &&
    defaultLocale !== locale
  ) {
    existingDict[defaultLocale] = origVal
  }
  existingDict[locale] = incomingVal
  return existingDict
}

function mergeLocalizedContainer(
  origVal: unknown,
  incomingVal: unknown,
  locale: string,
): Record<string, unknown> {
  const existingDict: Record<string, unknown> =
    origVal && typeof origVal === 'object' && !Array.isArray(origVal)
      ? { ...(origVal as Record<string, unknown>) }
      : {}
  existingDict[locale] = Array.isArray(incomingVal) ? incomingVal : []
  return existingDict
}

function mergeSubfieldContainerItem(
  incomingItem: Record<string, unknown>,
  origArr: Array<Record<string, unknown>>,
  subFields: Fields | readonly unknown[],
  locale: string,
  defaultLocale?: string,
): Record<string, unknown> {
  const itemId =
    typeof incomingItem.id === 'string' || typeof incomingItem.id === 'number'
      ? String(incomingItem.id)
      : undefined
  const matchingOrig = itemId ? origArr.find((x) => String(x.id) === itemId) : undefined
  if (matchingOrig) {
    return mergeDraftLocaleData(subFields, matchingOrig, incomingItem, locale, defaultLocale)
  }
  const subList = normalizeFieldList(subFields)
  const result: Record<string, unknown> = { ...incomingItem }
  for (const f of subList) {
    if (f.localized && f.name in incomingItem) {
      result[f.name] = { [locale]: incomingItem[f.name] }
    }
  }
  return result
}

function mergeSubfieldContainer(
  origVal: unknown,
  incomingVal: unknown,
  field: CommonFieldInfo,
  locale: string,
  defaultLocale?: string,
): unknown[] {
  if (!Array.isArray(incomingVal)) return Array.isArray(origVal) ? (origVal as unknown[]) : []
  const origArr = Array.isArray(origVal) ? (origVal as Array<Record<string, unknown>>) : []
  const incArr = incomingVal as readonly unknown[]

  return incArr.map((item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item
    const incObj = item as Record<string, unknown>
    if (field.type === 'blocks') {
      const blockDef = findBlockDef(field.blocks, String(incObj.blockType))
      return blockDef
        ? mergeSubfieldContainerItem(incObj, origArr, blockDef.fields, locale, defaultLocale)
        : incObj
    }
    return field.fields
      ? mergeSubfieldContainerItem(incObj, origArr, field.fields as Fields, locale, defaultLocale)
      : incObj
  })
}

function mergeDraftGroupField(
  origVal: unknown,
  incomingVal: unknown,
  fields: unknown,
  locale: string,
  defaultLocale?: string,
): unknown {
  const origGroup =
    origVal && typeof origVal === 'object' && !Array.isArray(origVal)
      ? (origVal as Record<string, unknown>)
      : {}
  const incGroup =
    incomingVal && typeof incomingVal === 'object' && !Array.isArray(incomingVal)
      ? (incomingVal as Record<string, unknown>)
      : {}
  return mergeDraftLocaleData(fields as Fields, origGroup, incGroup, locale, defaultLocale)
}

function mergeDraftNonLocalizedField(
  origVal: unknown,
  incomingVal: unknown,
  field: CommonFieldInfo,
  locale: string,
  defaultLocale?: string,
): unknown {
  if (field.type === 'group' && field.fields) {
    return mergeDraftGroupField(origVal, incomingVal, field.fields, locale, defaultLocale)
  }
  if (field.type === 'array' || field.type === 'blocks') {
    return mergeSubfieldContainer(origVal, incomingVal, field, locale, defaultLocale)
  }
  return incomingVal
}

function mergeDraftSingleField(
  origVal: unknown,
  incomingVal: unknown,
  field: CommonFieldInfo,
  locale: string,
  defaultLocale?: string,
): unknown {
  if (field.localized) {
    return field.type === 'array' || field.type === 'blocks'
      ? mergeLocalizedContainer(origVal, incomingVal, locale)
      : mergeLocalizedScalar(origVal, incomingVal, locale, defaultLocale)
  }
  return mergeDraftNonLocalizedField(origVal, incomingVal, field, locale, defaultLocale)
}

export function mergeDraftLocaleData(
  fields: Fields | readonly unknown[],
  originalDoc: DocumentData,
  incomingData: DocumentData,
  locale: string | undefined,
  defaultLocale?: string,
): DocumentData {
  if (!locale || locale === 'all') {
    return { ...originalDoc, ...incomingData }
  }

  const fieldList = normalizeFieldList(fields)
  const fieldMap = new Map<string, CommonFieldInfo>()
  for (const field of fieldList) {
    fieldMap.set(field.name, field)
  }

  const merged: DocumentData = { ...originalDoc }

  for (const [key, incomingVal] of Object.entries(incomingData)) {
    const field = fieldMap.get(key)
    if (field) {
      merged[key] = mergeDraftSingleField(
        originalDoc[key],
        incomingVal,
        field,
        locale,
        defaultLocale,
      )
    } else {
      merged[key] = incomingVal
    }
  }

  return merged
}
