import { SYSTEM_FIELDS, UPLOAD_SYSTEM_FIELDS } from '../client/system-fields'
import type {
  ArrayField,
  Block,
  BlocksField,
  CodeField,
  CollapsibleField,
  Field,
  GroupField,
  JsonField,
  NumberField,
  PointField,
  RadioField,
  RelationshipField,
  RowField,
  SlugField,
  Tab,
  TabsField,
  TextareaField,
  TextField,
  UploadField,
} from '../fields/types'
import { flattenFields, isLayoutField } from '../fields/flatten'
import type { DatabaseAdapter } from '../database/adapter'
import type { CollectionConfig, Config, GlobalConfig, PaginationConfig } from './types'
import { validateAdminConfig } from './validate-admin'
import { validateActions } from './validate-actions'
import { validateEndpoints } from './validate-endpoints'

const SLUG = /^[a-z][a-z0-9-]*$/
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Converts a kebab-case or snake-case slug to a camelCase JavaScript identifier.
 * Matches the identifier generation used by Drizzle schema generators.
 */
export function slugToIdentifier(slug: string): string {
  return slug.replace(/[-_]([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

/** Slugs that would collide with fixed API routes or auth tables. */
export const RESERVED_SLUGS = new Set([
  'globals',
  'auth',
  'user',
  'session',
  'account',
  'verification',
  'apikey',
  'rateLimit',
  'rate-limit',
  'ratelimit',
])

/** Generated schema identifiers that would collide with fixed API routes or auth tables. */
export const RESERVED_IDENTIFIERS = new Set([
  'globals',
  'auth',
  'user',
  'session',
  'account',
  'verification',
  'apikey',
  'rateLimit',
])
const SYSTEM_FIELD_NAMES = new Set<string>(SYSTEM_FIELDS)
const UPLOAD_SYSTEM_FIELD_NAMES = new Set<string>(UPLOAD_SYSTEM_FIELDS)
const TEXT_LIKE_FIELD_TYPES = new Set(['text', 'textarea', 'email', 'select'])
/**
 * Default MySQL VARCHAR limit.
 * @deprecated Sourced from `adapter.maxStringLength` per ADR 0025.
 */
export const MAX_VARCHAR_LENGTH = 16383

export class LontarConfigError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid Lontar config:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'LontarConfigError'
    this.issues = issues
  }
}

/**
 * Validates the config and returns it unchanged. Every problem is reported in a
 * single LontarConfigError, so a broken config is fixed in one pass.
 */
export function defineConfig<C extends Config>(config: C): C {
  const issues = validateConfig(config)
  if (issues.length > 0) throw new LontarConfigError(issues)
  if (config.localization && config.db) {
    config.db.localization = config.localization
  }
  return config
}

function validateConfig(config: Config): string[] {
  const issues = validateSecret(config.secret)
  issues.push(...validateAuth(config.auth))
  issues.push(...validatePagination('Config', config.pagination))
  const { issues: localizationIssues, hasLocalization } = validateLocalization(config.localization)
  issues.push(...localizationIssues)
  const { issues: collectionIssues, collectionMap } = validateCollections(
    config.collections,
    config.db,
    hasLocalization,
  )
  issues.push(...collectionIssues)
  issues.push(...validateGlobals(config.globals, collectionMap, config.db, hasLocalization))
  issues.push(...validateStorage(config))
  issues.push(...validateRootWebhooks(config.webhooks, collectionMap, config.globals))
  issues.push(...validateEndpoints(config))
  issues.push(...validateAdminConfig(config))
  return issues
}

const LOCALE_CODE_REGEX = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/

function isValidLocaleCode(code: string): boolean {
  return LOCALE_CODE_REGEX.test(code) && code.length <= 10 && !code.includes('_')
}

function validateStringLocale(code: string, raw: string, validCodes: Set<string>): string[] {
  if (!code || !isValidLocaleCode(code)) {
    return [
      `Locale code "${raw}" is invalid. Codes must match format (e.g. "en", "id", "en-US", "zh-CN") and be at most 10 characters without underscores.`,
    ]
  }
  if (validCodes.has(code)) {
    return [`Duplicate locale code "${code}" in localization.locales.`]
  }
  validCodes.add(code)
  return []
}

function validateObjectLocale(obj: Record<string, unknown>, validCodes: Set<string>): string[] {
  const code = typeof obj.code === 'string' ? obj.code.trim() : ''
  const issues = validateStringLocale(code, String(obj.code), validCodes)
  if (issues.length > 0) return issues
  if (obj.label !== undefined && (typeof obj.label !== 'string' || !obj.label.trim())) {
    return [`Locale label for code "${code}" must be a non-empty string.`]
  }
  return []
}

function validateLocaleItem(item: unknown, validCodes: Set<string>): string[] {
  if (typeof item === 'string') {
    return validateStringLocale(item.trim(), item, validCodes)
  }

  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    return validateObjectLocale(item as Record<string, unknown>, validCodes)
  }

  return ['Each locale in `localization.locales` must be a string code or { code, label } object.']
}

function validateLocaleList(locales: unknown): { issues: string[]; validCodes: Set<string> } {
  if (!Array.isArray(locales)) {
    return {
      issues: ['`localization.locales` must be an array of locale codes or locale objects.'],
      validCodes: new Set(),
    }
  }
  if (locales.length === 0) {
    return {
      issues: ['`localization.locales` must contain at least one locale.'],
      validCodes: new Set(),
    }
  }
  const issues: string[] = []
  const validCodes = new Set<string>()
  for (const item of locales) {
    issues.push(...validateLocaleItem(item, validCodes))
  }
  return { issues, validCodes }
}

function validateDefaultLocale(defaultLocale: unknown, validCodes: Set<string>): string[] {
  if (typeof defaultLocale !== 'string' || !defaultLocale.trim()) {
    return ['`localization.defaultLocale` must be a non-empty string.']
  }
  if (validCodes.size > 0 && !validCodes.has(defaultLocale)) {
    return [`Default locale "${defaultLocale}" is not in localization.locales.`]
  }
  return []
}

function validateLocalization(localization: unknown): {
  issues: string[]
  hasLocalization: boolean
} {
  if (localization === undefined) {
    return { issues: [], hasLocalization: false }
  }
  if (typeof localization !== 'object' || localization === null || Array.isArray(localization)) {
    return { issues: ['`localization` must be an object.'], hasLocalization: true }
  }
  const loc = localization as Record<string, unknown>
  const { issues, validCodes } = validateLocaleList(loc.locales)
  issues.push(...validateDefaultLocale(loc.defaultLocale, validCodes))

  if (loc.fallback !== undefined && typeof loc.fallback !== 'boolean') {
    issues.push('`localization.fallback` must be a boolean.')
  }

  return { issues, hasLocalization: true }
}

function validateStorage(config: Config): string[] {
  const hasUpload = config.collections.some((c) => Boolean(c.upload))
  if (hasUpload && !config.storage) {
    return [
      'A collection has `upload` enabled, but no `storage` adapter was provided in defineConfig({ storage: ... }).',
    ]
  }
  return []
}

function validateSecret(secret: unknown): string[] {
  if (typeof secret === 'string' && secret.length > 0) return []
  return [
    '`secret` must be a non-empty string. Check that the environment variable it reads is set.',
  ]
}

function validateRoleList(roles: unknown): { issues: string[]; effectiveRoles: string[] } {
  if (roles === undefined) {
    return { issues: [], effectiveRoles: ['admin', 'editor'] }
  }
  if (!Array.isArray(roles)) {
    return { issues: ['`auth.roles` must be an array of role name strings.'], effectiveRoles: [] }
  }
  if (roles.length === 0) {
    return { issues: ['`auth.roles` must contain at least one role.'], effectiveRoles: [] }
  }
  const issues: string[] = []
  const seen = new Set<string>()
  const validatedRoles: string[] = []
  for (const role of roles) {
    if (typeof role !== 'string' || !role.trim()) {
      issues.push('Each role in `auth.roles` must be a non-empty string.')
    } else if (seen.has(role)) {
      issues.push(`Role "${role}" is duplicated in auth.roles.`)
    } else {
      seen.add(role)
      validatedRoles.push(role)
    }
  }
  return { issues, effectiveRoles: validatedRoles }
}

function validateDefaultRole(
  defaultRole: unknown,
  roles: string[],
  rolesProvided: boolean,
): string[] {
  if (defaultRole !== undefined) {
    if (typeof defaultRole !== 'string' || !defaultRole.trim()) {
      return ['`auth.defaultRole` must be a non-empty string.']
    }
    if (!roles.includes(defaultRole)) {
      return [`Default role "${defaultRole}" is not in auth.roles.`]
    }
    return []
  }
  if (rolesProvided && !roles.includes('editor')) {
    return ['Default role "editor" is not in auth.roles. Specify auth.defaultRole.']
  }
  return []
}

function validateAdminRole(adminRole: unknown, roles: string[], rolesProvided: boolean): string[] {
  if (adminRole !== undefined) {
    if (typeof adminRole !== 'string' || !adminRole.trim()) {
      return ['`auth.adminRole` must be a non-empty string.']
    }
    if (!roles.includes(adminRole)) {
      return [`Admin role "${adminRole}" is not in auth.roles.`]
    }
    return []
  }
  if (rolesProvided && !roles.includes('admin')) {
    return ['Admin role "admin" is not in auth.roles. Specify auth.adminRole.']
  }
  return []
}

function validateAuth(auth: Config['auth']): string[] {
  if (auth === undefined) return []
  if (typeof auth !== 'object' || auth === null || Array.isArray(auth)) {
    return ['`auth` must be an object.']
  }
  const { issues, effectiveRoles } = validateRoleList(auth.roles)
  const rolesProvided = auth.roles !== undefined
  issues.push(...validateDefaultRole(auth.defaultRole, effectiveRoles, rolesProvided))
  issues.push(...validateAdminRole(auth.adminRole, effectiveRoles, rolesProvided))
  return issues
}

function checkIdentifierCollision(
  identifiers: Map<string, string>,
  slug: string,
  kind: 'Collection' | 'Global',
): string | null {
  const identifier = slugToIdentifier(slug)
  const existing = identifiers.get(identifier)
  if (existing && existing !== slug) {
    return `${kind} slug "${slug}" generates identifier "${identifier}" which collides with "${existing}".`
  }
  identifiers.set(identifier, slug)
  return null
}

function validateCollections(
  collections: readonly CollectionConfig[],
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
): {
  issues: string[]
  collectionMap: Map<string, CollectionConfig>
} {
  const issues: string[] = []
  const slugs = new Set<string>()
  const identifiers = new Map<string, string>()
  const collectionMap = new Map<string, CollectionConfig>()
  for (const collection of collections) {
    if (slugs.has(collection.slug)) {
      issues.push(`Collection slug "${collection.slug}" is used twice.`)
    }
    slugs.add(collection.slug)
    const collision = checkIdentifierCollision(identifiers, collection.slug, 'Collection')
    if (collision) issues.push(collision)
    collectionMap.set(collection.slug, collection)
    issues.push(...validateCollection(collection, dbAdapter, hasLocalization))
  }
  for (const collection of collections) {
    issues.push(
      ...validateFieldTargets(`Collection "${collection.slug}"`, collection.fields, collectionMap),
    )
  }
  return { issues, collectionMap }
}

function validateGlobals(
  globals: readonly GlobalConfig[] | undefined,
  collectionMap: Map<string, CollectionConfig>,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
): string[] {
  if (!globals) return []
  const issues: string[] = []
  const seen = new Set<string>()
  const identifiers = new Map<string, string>()
  for (const [slug] of collectionMap) {
    identifiers.set(slugToIdentifier(slug), slug)
  }
  for (const global of globals) {
    if (seen.has(global.slug)) {
      issues.push(`Global slug "${global.slug}" is used twice.`)
    }
    if (collectionMap.has(global.slug)) {
      issues.push(`Global slug "${global.slug}" collides with a collection slug.`)
    }
    const collision = checkIdentifierCollision(identifiers, global.slug, 'Global')
    if (collision) issues.push(collision)
    seen.add(global.slug)
    issues.push(...validateGlobal(global, dbAdapter, hasLocalization))
    issues.push(...validateFieldTargets(`Global "${global.slug}"`, global.fields, collectionMap))
  }
  return issues
}

function validateFieldTargets(
  where: string,
  fields: Record<string, Field>,
  collectionMap: Map<string, CollectionConfig>,
): string[] {
  const issues: string[] = []
  for (const [name, field] of Object.entries(flattenFields(fields))) {
    if (field.type === 'upload') {
      issues.push(...validateUploadTarget(where, name, field, collectionMap))
    } else if (field.type === 'relationship') {
      issues.push(...validateRelationshipTarget(where, name, field, collectionMap))
    } else if (field.type === 'group' || field.type === 'array') {
      issues.push(...validateFieldTargets(where, field.fields, collectionMap))
    } else if (field.type === 'blocks') {
      for (const block of field.blocks) {
        issues.push(...validateFieldTargets(where, block.fields, collectionMap))
      }
    }
  }
  return issues
}

function validateUploadTarget(
  where: string,
  name: string,
  field: UploadField,
  collectionMap: Map<string, CollectionConfig>,
): string[] {
  const target = collectionMap.get(field.relationTo)
  if (!target) {
    return [`${where}: upload field "${name}" refers to unknown collection "${field.relationTo}".`]
  }
  if (!target.upload) {
    return [
      `${where}: upload field "${name}" refers to collection "${field.relationTo}" which does not have upload enabled.`,
    ]
  }
  return []
}

function validateRelationshipTarget(
  where: string,
  name: string,
  field: RelationshipField,
  collectionMap: Map<string, CollectionConfig>,
): string[] {
  if (!collectionMap.has(field.relationTo)) {
    return [
      `${where}: relationship field "${name}" refers to unknown collection "${field.relationTo}".`,
    ]
  }
  return []
}

function validateCollection(
  collection: CollectionConfig,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
): string[] {
  const where = `Collection "${collection.slug}"`
  const isUpload = Boolean(collection.upload)
  const hasVersions = Boolean(collection.versions)
  return [
    ...validateSlug(collection.slug, 'Collection'),
    ...validateFields(
      where,
      collection.fields,
      isUpload,
      1,
      hasVersions,
      dbAdapter,
      hasLocalization,
    ),
    ...validatePagination(where, collection.pagination),
    ...validateVersions(where, collection.versions),
    ...validateAdmin(where, collection),
    ...validateAccess(where, collection),
    ...validateScopedWebhooks(where, collection.webhooks),
  ]
}

function validateAutosave(where: string, autosave: unknown): string[] {
  if (autosave === undefined) return []
  if (typeof autosave === 'boolean') return []
  if (typeof autosave !== 'object' || autosave === null || Array.isArray(autosave)) {
    return [`${where}: autosave must be a boolean or an object.`]
  }
  const obj = autosave as Record<string, unknown>
  if (obj.interval !== undefined) {
    if (typeof obj.interval !== 'number' || !Number.isInteger(obj.interval) || obj.interval < 500) {
      return [`${where}: autosave.interval must be an integer of at least 500ms.`]
    }
  }
  return []
}

function validateDrafts(where: string, drafts: unknown): string[] {
  if (drafts === undefined) return []
  if (typeof drafts === 'boolean') return []
  if (typeof drafts === 'object' && drafts !== null && !Array.isArray(drafts)) {
    const d = drafts as Record<string, unknown>
    return validateAutosave(`${where}: versions.drafts`, d.autosave)
  }
  return [`${where}: versions.drafts must be a boolean or an object.`]
}

function validateMaxPerDoc(where: string, maxPerDoc: unknown): string[] {
  if (maxPerDoc === undefined) return []
  if (typeof maxPerDoc !== 'number' || !Number.isInteger(maxPerDoc) || maxPerDoc < 0) {
    return [`${where}: versions.maxPerDoc must be a non-negative integer.`]
  }
  return []
}

function validateVersions(where: string, versions?: unknown): string[] {
  if (versions === undefined || versions === null) return []
  if (typeof versions !== 'object' || Array.isArray(versions)) {
    return [`${where}: \`versions\` must be an object.`]
  }
  const v = versions as Record<string, unknown>
  const draftsEnabled = Boolean(
    v.drafts === true || (typeof v.drafts === 'object' && v.drafts !== null),
  )

  const issues = [
    ...validateDrafts(where, v.drafts),
    ...validateAutosave(`${where}: versions`, v.autosave),
    ...validateMaxPerDoc(where, v.maxPerDoc),
  ]

  if (v.autosave !== undefined && !draftsEnabled) {
    issues.push(`${where}: versions.autosave requires drafts to be enabled.`)
  }

  return issues
}

function validatePaginationBound(
  where: string,
  key: 'defaultLimit' | 'maxLimit',
  value: number | undefined,
): string[] {
  if (value === undefined) return []
  if (!Number.isInteger(value) || value <= 0) {
    return [`${where}: pagination.${key} must be a positive integer.`]
  }
  return []
}

function validatePagination(where: string, pagination: PaginationConfig | undefined): string[] {
  if (!pagination) return []
  const issues = [
    ...validatePaginationBound(where, 'defaultLimit', pagination.defaultLimit),
    ...validatePaginationBound(where, 'maxLimit', pagination.maxLimit),
  ]
  const { defaultLimit, maxLimit } = pagination
  if (defaultLimit !== undefined && maxLimit !== undefined && defaultLimit > maxLimit) {
    issues.push(
      `${where}: pagination.defaultLimit (${defaultLimit}) cannot be greater than pagination.maxLimit (${maxLimit}).`,
    )
  }
  return issues
}

function validateGlobal(
  global: GlobalConfig,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
): string[] {
  const where = `Global "${global.slug}"`
  const hasVersions = Boolean(global.versions)
  return [
    ...validateSlug(global.slug, 'Global'),
    ...validateFields(where, global.fields, false, 1, hasVersions, dbAdapter, hasLocalization),
    ...validateVersions(where, global.versions),
    ...validatePreview(where, global.admin?.preview),
    ...validateActions(where, global.admin?.actions, global.endpoints, true),
    ...validateGlobalAccess(where, global),
    ...validateScopedWebhooks(where, global.webhooks),
  ]
}

function validateFieldLocalization(
  where: string,
  name: string,
  field: Field,
  hasLocalization: boolean,
  containerLocalized: boolean,
): string[] {
  if (field.type === 'tabs' || field.type === 'row' || field.type === 'collapsible') {
    if ((field as unknown as { localized?: boolean }).localized) {
      return [
        `${where}: layout field "${name}" (${field.type}) cannot be localized. Set localized on its child fields instead.`,
      ]
    }
    return []
  }
  if (!field.localized) return []
  if (!hasLocalization) {
    return [
      `${where}: field "${name}" has localized: true, but localization is not configured in defineConfig({ localization: ... }).`,
    ]
  }
  if (containerLocalized) {
    return [
      `${where}: field "${name}" cannot be localized because its parent container is already localized.`,
    ]
  }
  return []
}

interface ScopeFieldItem {
  name: string
  path: string
  isLayout: boolean
}

function collectScopeFields(
  fields: Record<string, Field>,
  currentPath: string,
  collected: ScopeFieldItem[],
): void {
  for (const [name, field] of Object.entries(fields)) {
    const fieldPath = currentPath ? `${currentPath} -> field "${name}"` : `field "${name}"`
    if (field.type === 'tabs') {
      collected.push({ name, path: fieldPath, isLayout: true })
      for (const tab of field.tabs ?? []) {
        collectScopeFields(tab.fields ?? {}, `${fieldPath} -> tab "${tab.label}"`, collected)
      }
    } else if (field.type === 'row' || field.type === 'collapsible') {
      collected.push({ name, path: fieldPath, isLayout: true })
      collectScopeFields(field.fields ?? {}, fieldPath, collected)
    } else {
      collected.push({ name, path: fieldPath, isLayout: false })
    }
  }
}

function validateScopeFieldCollisions(where: string, fields: Record<string, Field>): string[] {
  const collected: ScopeFieldItem[] = []
  collectScopeFields(fields, '', collected)

  const issues: string[] = []
  const dataFieldMap = new Map<string, string>()
  const layoutFieldMap = new Map<string, string>()

  for (const item of collected) {
    if (item.isLayout) {
      if (!layoutFieldMap.has(item.name)) {
        layoutFieldMap.set(item.name, item.path)
      }
    } else {
      if (dataFieldMap.has(item.name)) {
        const prevPath = dataFieldMap.get(item.name)!
        issues.push(
          `${where}: duplicate field name "${item.name}" in the same scope (declared in ${prevPath} and ${item.path}).`,
        )
      } else {
        dataFieldMap.set(item.name, item.path)
      }
    }
  }

  for (const [name, path] of dataFieldMap) {
    if (layoutFieldMap.has(name)) {
      const layoutPath = layoutFieldMap.get(name)!
      issues.push(
        `${where}: field name "${name}" (${path}) collides with layout container "${layoutPath}".`,
      )
    }
  }

  return issues
}

interface FieldsValidationContext {
  isUpload: boolean
  depth: number
  hasVersions: boolean
  dbAdapter?: DatabaseAdapter
  hasLocalization: boolean
  containerLocalized: boolean
  layoutDepth: number
}

function validateFieldEntry(
  where: string,
  name: string,
  field: Field,
  fields: Record<string, Field>,
  ctx: FieldsValidationContext,
): string[] {
  const isRoot = ctx.depth === 1 && ctx.layoutDepth === 0
  const issues = [
    ...validateFieldName(where, name, isRoot && ctx.isUpload, isRoot && ctx.hasVersions),
  ]
  if ((ctx.depth > 1 || ctx.layoutDepth > 0) && name === 'id') {
    issues.push(`${where}: field name "id" is reserved.`)
  }
  issues.push(
    ...validateFieldLocalization(where, name, field, ctx.hasLocalization, ctx.containerLocalized),
    ...validateField(
      where,
      name,
      field,
      fields,
      ctx.depth,
      ctx.dbAdapter,
      ctx.hasLocalization,
      ctx.containerLocalized,
      ctx.layoutDepth,
    ),
  )
  return issues
}

function validateFields(
  where: string,
  fields: Record<string, Field>,
  isUpload: boolean,
  depth: number,
  hasVersions = false,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
  layoutDepth = 0,
): string[] {
  const issues: string[] = []
  if (layoutDepth === 0) {
    issues.push(...validateScopeFieldCollisions(where, fields))
  }
  const ctx: FieldsValidationContext = {
    isUpload,
    depth,
    hasVersions,
    dbAdapter,
    hasLocalization,
    containerLocalized,
    layoutDepth,
  }
  for (const [name, field] of Object.entries(fields)) {
    issues.push(...validateFieldEntry(where, name, field, fields, ctx))
  }
  return issues
}

function validateGroupField(where: string, name: string, depth: number): string[] {
  if (depth > 3) {
    return [`${where}: group field "${name}" exceeds maximum nesting depth of 3.`]
  }
  return []
}

function validateMinRows(where: string, name: string, minRows?: number): string[] {
  if (minRows !== undefined && (!Number.isInteger(minRows) || minRows < 0)) {
    return [`${where}: array field "${name}" minRows must be a non-negative integer.`]
  }
  return []
}

function validateMaxRows(where: string, name: string, maxRows?: number): string[] {
  if (maxRows === undefined) return []
  if (!Number.isInteger(maxRows) || maxRows <= 0) {
    return [`${where}: array field "${name}" maxRows must be a positive integer.`]
  }
  if (maxRows > 500) {
    return [`${where}: array field "${name}" maxRows (${maxRows}) exceeds maximum of 500.`]
  }
  return []
}

function validateArrayBounds(where: string, name: string, field: ArrayField): string[] {
  const issues = [
    ...validateMinRows(where, name, field.minRows),
    ...validateMaxRows(where, name, field.maxRows),
  ]
  if (field.minRows !== undefined && field.maxRows !== undefined && field.minRows > field.maxRows) {
    issues.push(
      `${where}: array field "${name}" minRows (${field.minRows}) cannot be greater than maxRows (${field.maxRows}).`,
    )
  }
  return issues
}

function validateArrayField(
  where: string,
  name: string,
  field: ArrayField,
  depth: number,
): string[] {
  const issues = validateArrayBounds(where, name, field)
  if (depth > 3) {
    issues.push(`${where}: array field "${name}" exceeds maximum nesting depth of 3.`)
  }
  if (field.admin?.rowLabel && !field.fields[field.admin.rowLabel]) {
    issues.push(
      `${where}: array field "${name}" admin.rowLabel refers to unknown field "${field.admin.rowLabel}".`,
    )
  }
  return issues
}

function validateBlocksBounds(where: string, name: string, field: BlocksField): string[] {
  const issues = [
    ...validateMinRows(where, name, field.minRows),
    ...validateMaxRows(where, name, field.maxRows),
  ]
  if (field.minRows !== undefined && field.maxRows !== undefined && field.minRows > field.maxRows) {
    issues.push(
      `${where}: blocks field "${name}" minRows (${field.minRows}) cannot be greater than maxRows (${field.maxRows}).`,
    )
  }
  return issues
}

function validateBlockSlugs(where: string, name: string, blocks: readonly Block[]): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    if (!block.slug || typeof block.slug !== 'string') {
      issues.push(`${where}: blocks field "${name}" contains a block with an invalid slug.`)
      continue
    }
    if (seen.has(block.slug)) {
      issues.push(`${where}: blocks field "${name}" has duplicate block slug "${block.slug}".`)
    }
    seen.add(block.slug)
  }
  return issues
}

function validateBlocksField(
  where: string,
  name: string,
  field: BlocksField,
  depth: number,
): string[] {
  const issues = validateBlocksBounds(where, name, field)
  if (depth > 3) {
    issues.push(`${where}: blocks field "${name}" exceeds maximum nesting depth of 3.`)
  }
  if (!field.blocks || field.blocks.length === 0) {
    issues.push(`${where}: blocks field "${name}" must define at least one block.`)
  } else {
    issues.push(...validateBlockSlugs(where, name, field.blocks))
  }
  return issues
}

function validateBlocksContent(
  where: string,
  name: string,
  field: BlocksField,
  depth: number,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
): string[] {
  const issues: string[] = []
  if (!field.blocks) return issues
  for (const block of field.blocks) {
    if ('id' in block.fields) {
      issues.push(
        `${where} -> blocks "${name}" -> block "${block.slug}": field name "id" is reserved.`,
      )
    }
    if ('blockType' in block.fields) {
      issues.push(
        `${where} -> blocks "${name}" -> block "${block.slug}": field name "blockType" is reserved.`,
      )
    }
    issues.push(
      ...validateFields(
        `${where} -> blocks "${name}" -> block "${block.slug}"`,
        block.fields,
        false,
        depth + 1,
        false,
        dbAdapter,
        hasLocalization,
        containerLocalized,
      ),
    )
  }
  return issues
}

const FIELD_ACCESS_OPS = ['read', 'create', 'update'] as const
type FieldAccessOp = (typeof FIELD_ACCESS_OPS)[number]

function validateFieldAccessKeys(
  where: string,
  name: string,
  access: Record<string, unknown>,
): string[] {
  const issues: string[] = []
  for (const key of Object.keys(access)) {
    if (!FIELD_ACCESS_OPS.includes(key as FieldAccessOp)) {
      issues.push(
        `${where}: field "${name}" access does not support "${key}". Only "read", "create", and "update" are supported.`,
      )
    }
  }
  return issues
}

function validateFieldAccessOps(
  where: string,
  name: string,
  access: Record<string, unknown>,
): string[] {
  const issues: string[] = []
  for (const op of FIELD_ACCESS_OPS) {
    const fn = access[op]
    if (fn !== undefined && typeof fn !== 'function') {
      issues.push(`${where}: field "${name}" access.${op} must be a function.`)
    }
  }
  return issues
}

function validateFieldAccess(where: string, name: string, field: Field): string[] {
  const access = (field as unknown as { access?: unknown }).access
  if (access === undefined) return []
  if (field.type === 'tabs' || field.type === 'row' || field.type === 'collapsible') {
    return [
      `${where}: layout field "${name}" (${field.type}) cannot declare access control. Set access on its child fields instead.`,
    ]
  }
  if (typeof access !== 'object' || access === null) {
    return [`${where}: field "${name}" access must be an object.`]
  }
  const obj = access as Record<string, unknown>
  return [...validateFieldAccessKeys(where, name, obj), ...validateFieldAccessOps(where, name, obj)]
}

function validateContainerField(
  where: string,
  name: string,
  field: GroupField | ArrayField | BlocksField,
  depth: number,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
): string[] {
  if (field.type === 'group') {
    return [
      ...validateGroupField(where, name, depth),
      ...validateFields(
        `${where} -> group "${name}"`,
        field.fields,
        false,
        depth + 1,
        false,
        dbAdapter,
        hasLocalization,
        containerLocalized,
      ),
    ]
  }
  if (field.type === 'array') {
    return [
      ...validateArrayField(where, name, field, depth),
      ...validateFields(
        `${where} -> array "${name}"`,
        field.fields,
        false,
        depth + 1,
        false,
        dbAdapter,
        hasLocalization,
        containerLocalized || Boolean(field.localized),
      ),
    ]
  }
  return [
    ...validateBlocksField(where, name, field, depth),
    ...validateBlocksContent(
      where,
      name,
      field,
      depth,
      dbAdapter,
      hasLocalization,
      containerLocalized || Boolean(field.localized),
    ),
  ]
}

function validateTextLikeField(
  where: string,
  name: string,
  field: Field,
  fields: Record<string, Field>,
  dbAdapter?: DatabaseAdapter,
): string[] | null {
  switch (field.type) {
    case 'text':
      return validateTextField(where, name, field, dbAdapter)
    case 'textarea':
      return validateTextareaField(where, name, field)
    case 'code':
      return validateCodeField(where, name, field)
    case 'slug':
      return validateSlugField(where, name, field, fields)
    default:
      return null
  }
}

function validateScalarField(where: string, name: string, field: Field): string[] | null {
  switch (field.type) {
    case 'number':
      return validateNumberField(where, name, field)
    case 'json':
      return validateJsonField(where, name, field)
    case 'radio':
      return validateRadioField(where, name, field)
    case 'point':
      return validatePointField(where, name, field)
    default:
      return null
  }
}

function validateLayoutDepth(
  where: string,
  name: string,
  type: string,
  layoutDepth: number,
): string[] {
  if (layoutDepth >= 3) {
    return [`${where}: layout field "${name}" (${type}) exceeds maximum layout nesting depth of 3.`]
  }
  return []
}

function validateTabLabel(where: string, tabsName: string, label: string, index: number): string[] {
  if (!label) {
    return [
      `${where}: tab ${index} in tabs field "${tabsName}" must have a non-empty string "label".`,
    ]
  }
  return []
}

function validateTabAdmin(where: string, tab: Tab, label: string): string[] {
  if (
    tab.admin?.condition !== undefined &&
    (typeof tab.admin.condition !== 'object' ||
      tab.admin.condition === null ||
      Array.isArray(tab.admin.condition))
  ) {
    return [`${where} -> tab "${label}": admin.condition must be an object.`]
  }
  return []
}

function validateSingleTab(
  where: string,
  tabsName: string,
  rawTab: unknown,
  index: number,
  ctx: FieldsValidationContext,
): string[] {
  if (!rawTab || typeof rawTab !== 'object') {
    return [`${where} -> tabs "${tabsName}": each tab must be an object.`]
  }
  const tab = rawTab as Tab
  const label = typeof tab.label === 'string' && tab.label.trim() ? tab.label : ''
  const tabName = label || 'unnamed'
  const issues = validateTabLabel(where, tabsName, label, index)
  if (!tab.fields || typeof tab.fields !== 'object') {
    issues.push(
      `${where} -> tabs "${tabsName}" -> tab "${tabName}": tab must have a fields object.`,
    )
    return issues
  }
  issues.push(...validateTabAdmin(where, tab, label))
  issues.push(
    ...validateFields(
      `${where} -> tab "${tabName}"`,
      tab.fields,
      false,
      ctx.depth,
      false,
      ctx.dbAdapter,
      ctx.hasLocalization,
      ctx.containerLocalized,
      ctx.layoutDepth + 1,
    ),
  )
  return issues
}

function validateTabsField(
  where: string,
  name: string,
  field: TabsField,
  depth: number,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
  layoutDepth = 0,
): string[] {
  if (!Array.isArray(field.tabs) || field.tabs.length === 0) {
    return [`${where}: tabs field "${name}" must define at least one tab.`]
  }
  const issues: string[] = []
  const ctx: FieldsValidationContext = {
    isUpload: false,
    depth,
    hasVersions: false,
    dbAdapter,
    hasLocalization,
    containerLocalized,
    layoutDepth,
  }
  field.tabs.forEach((tab, index) => {
    issues.push(...validateSingleTab(where, name, tab, index, ctx))
  })
  return issues
}

function validateRowField(
  where: string,
  name: string,
  field: RowField,
  depth: number,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
  layoutDepth = 0,
): string[] {
  if (!field.fields || typeof field.fields !== 'object') {
    return [`${where}: row field "${name}" must have a fields object.`]
  }
  return validateFields(
    `${where} -> row "${name}"`,
    field.fields,
    false,
    depth,
    false,
    dbAdapter,
    hasLocalization,
    containerLocalized,
    layoutDepth + 1,
  )
}

function validateCollapsibleField(
  where: string,
  name: string,
  field: CollapsibleField,
  depth: number,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
  layoutDepth = 0,
): string[] {
  const issues: string[] = []
  if (typeof field.label !== 'string' || !field.label.trim()) {
    issues.push(`${where}: collapsible field "${name}" must have a non-empty string label.`)
  }
  if (!field.fields || typeof field.fields !== 'object') {
    issues.push(`${where}: collapsible field "${name}" must have a fields object.`)
    return issues
  }
  if (field.initiallyCollapsed !== undefined && typeof field.initiallyCollapsed !== 'boolean') {
    issues.push(`${where}: collapsible field "${name}" initiallyCollapsed must be a boolean.`)
  }
  issues.push(
    ...validateFields(
      `${where} -> collapsible "${name}"`,
      field.fields,
      false,
      depth,
      false,
      dbAdapter,
      hasLocalization,
      containerLocalized,
      layoutDepth + 1,
    ),
  )
  return issues
}

function validateLayoutField(
  where: string,
  name: string,
  field: TabsField | RowField | CollapsibleField,
  depth: number,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
  layoutDepth = 0,
): string[] {
  const depthIssues = validateLayoutDepth(where, name, field.type, layoutDepth)
  if (depthIssues.length > 0) return depthIssues

  switch (field.type) {
    case 'tabs':
      return validateTabsField(
        where,
        name,
        field,
        depth,
        dbAdapter,
        hasLocalization,
        containerLocalized,
        layoutDepth,
      )
    case 'row':
      return validateRowField(
        where,
        name,
        field,
        depth,
        dbAdapter,
        hasLocalization,
        containerLocalized,
        layoutDepth,
      )
    case 'collapsible':
      return validateCollapsibleField(
        where,
        name,
        field,
        depth,
        dbAdapter,
        hasLocalization,
        containerLocalized,
        layoutDepth,
      )
  }
}

function validateFieldType(
  where: string,
  name: string,
  field: Field,
  fields: Record<string, Field>,
  depth: number,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
  layoutDepth = 0,
): string[] {
  const textLike = validateTextLikeField(where, name, field, fields, dbAdapter)
  if (textLike) return textLike

  const scalar = validateScalarField(where, name, field)
  if (scalar) return scalar

  if (isLayoutField(field)) {
    return validateLayoutField(
      where,
      name,
      field,
      depth,
      dbAdapter,
      hasLocalization,
      containerLocalized,
      layoutDepth,
    )
  }

  if (field.type === 'group' || field.type === 'array' || field.type === 'blocks') {
    return validateContainerField(
      where,
      name,
      field,
      depth,
      dbAdapter,
      hasLocalization,
      containerLocalized,
    )
  }

  return []
}

const CONTAINER_FIELD_TYPES = new Set(['group', 'array', 'blocks', 'tabs', 'row', 'collapsible'])

function validateFieldComponent(where: string, name: string, field: Field): string[] {
  const component: unknown = field.admin?.component
  if (component === undefined) return []
  if (typeof component !== 'string' || component.trim() === '') {
    return [`${where}: field "${name}" admin.component must be a non-empty string.`]
  }
  if (CONTAINER_FIELD_TYPES.has(field.type)) {
    return [
      `${where}: ${field.type} field "${name}" cannot set admin.component. It renders its nested fields; set the component on one of them instead.`,
    ]
  }
  return []
}

function validateField(
  where: string,
  name: string,
  field: Field,
  fields: Record<string, Field>,
  depth: number,
  dbAdapter?: DatabaseAdapter,
  hasLocalization = false,
  containerLocalized = false,
  layoutDepth = 0,
): string[] {
  return [
    ...validateFieldAccess(where, name, field),
    ...validateFieldComponent(where, name, field),
    ...validateFieldType(
      where,
      name,
      field,
      fields,
      depth,
      dbAdapter,
      hasLocalization,
      containerLocalized,
      layoutDepth,
    ),
  ]
}

function validateSlugField(
  where: string,
  name: string,
  field: SlugField,
  fields: Record<string, Field>,
): string[] {
  if (field.from === undefined) return []
  if (field.from === name) {
    return [`${where}: slug field "${name}" cannot refer to itself in \`from\`.`]
  }
  const sourceField = fields[field.from]
  if (!sourceField) {
    return [`${where}: slug field "${name}" \`from\` refers to unknown field "${field.from}".`]
  }
  if (!TEXT_LIKE_FIELD_TYPES.has(sourceField.type)) {
    return [
      `${where}: slug field "${name}" \`from\` must refer to a text-like field, but "${field.from}" is of type "${sourceField.type}".`,
    ]
  }
  return []
}

function validateTextMaxLength(
  where: string,
  name: string,
  maxLength: number | undefined,
  dbAdapter?: DatabaseAdapter,
): string[] {
  if (maxLength === undefined) return []
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    return [`${where}: text field "${name}" maxLength must be a positive integer.`]
  }
  if (dbAdapter?.maxStringLength !== undefined && maxLength > dbAdapter.maxStringLength) {
    const dbLabel = dbAdapter.name === 'mysql' ? 'MySQL' : dbAdapter.name
    return [
      `${where}: text field "${name}" maxLength (${maxLength}) exceeds ${dbLabel} VARCHAR limit of ${dbAdapter.maxStringLength}. Use a textarea field for longer text.`,
    ]
  }
  return []
}

function validateTextMinLength(
  where: string,
  name: string,
  minLength: number | undefined,
  maxLength: number | undefined,
): string[] {
  if (minLength === undefined) return []
  if (!Number.isInteger(minLength) || minLength < 0) {
    return [`${where}: text field "${name}" minLength must be a non-negative integer.`]
  }
  if (maxLength !== undefined && minLength > maxLength) {
    return [
      `${where}: text field "${name}" minLength (${minLength}) cannot be greater than maxLength (${maxLength}).`,
    ]
  }
  return []
}

function validateScalarMinRows(
  where: string,
  name: string,
  fieldType: string,
  minRows?: number,
): string[] {
  if (minRows !== undefined && (!Number.isInteger(minRows) || minRows < 0)) {
    return [`${where}: ${fieldType} field "${name}" minRows must be a non-negative integer.`]
  }
  return []
}

function validateScalarMaxRows(
  where: string,
  name: string,
  fieldType: string,
  maxRows?: number,
): string[] {
  if (maxRows === undefined) return []
  if (!Number.isInteger(maxRows) || maxRows <= 0) {
    return [`${where}: ${fieldType} field "${name}" maxRows must be a positive integer.`]
  }
  if (maxRows > 500) {
    return [`${where}: ${fieldType} field "${name}" maxRows (${maxRows}) exceeds maximum of 500.`]
  }
  return []
}

function validateScalarRows(
  where: string,
  name: string,
  fieldType: string,
  minRows?: number,
  maxRows?: number,
): string[] {
  const issues = [
    ...validateScalarMinRows(where, name, fieldType, minRows),
    ...validateScalarMaxRows(where, name, fieldType, maxRows),
  ]
  if (minRows !== undefined && maxRows !== undefined && minRows > maxRows) {
    issues.push(
      `${where}: ${fieldType} field "${name}" minRows (${minRows}) cannot be greater than maxRows (${maxRows}).`,
    )
  }
  return issues
}

function validateHasManyRowOptions(
  where: string,
  name: string,
  fieldType: string,
  hasMany?: boolean,
  minRows?: number,
  maxRows?: number,
): string[] {
  if (!hasMany) {
    if (minRows !== undefined || maxRows !== undefined) {
      return [
        `${where}: ${fieldType} field "${name}" cannot set minRows or maxRows unless hasMany is true.`,
      ]
    }
    return []
  }
  return validateScalarRows(where, name, fieldType, minRows, maxRows)
}

function validateTextDefaultValue(where: string, name: string, field: TextField): string[] {
  if (field.defaultValue === undefined) return []
  if (field.hasMany) {
    if (!Array.isArray(field.defaultValue)) {
      return [`${where}: text field "${name}" defaultValue must be an array when hasMany is true.`]
    }
    if (field.defaultValue.some((v) => typeof v !== 'string')) {
      return [`${where}: text field "${name}" defaultValue must only contain strings.`]
    }
    return []
  }
  if (Array.isArray(field.defaultValue)) {
    return [
      `${where}: text field "${name}" defaultValue cannot be an array when hasMany is not true.`,
    ]
  }
  if (typeof field.defaultValue !== 'string') {
    return [`${where}: text field "${name}" defaultValue must be a string.`]
  }
  return []
}

function validateNumberArrayDefaultValue(
  where: string,
  name: string,
  field: NumberField,
): string[] {
  if (!Array.isArray(field.defaultValue)) {
    return [`${where}: number field "${name}" defaultValue must be an array when hasMany is true.`]
  }
  if (field.defaultValue.some((v) => typeof v !== 'number' || Number.isNaN(v))) {
    return [`${where}: number field "${name}" defaultValue must only contain numbers.`]
  }
  if (field.integer && field.defaultValue.some((v) => !Number.isInteger(v))) {
    return [
      `${where}: number field "${name}" defaultValue items must be integers when integer is true.`,
    ]
  }
  return []
}

function validateNumberScalarDefaultValue(
  where: string,
  name: string,
  field: NumberField,
): string[] {
  if (Array.isArray(field.defaultValue)) {
    return [
      `${where}: number field "${name}" defaultValue cannot be an array when hasMany is not true.`,
    ]
  }
  if (typeof field.defaultValue !== 'number' || Number.isNaN(field.defaultValue)) {
    return [`${where}: number field "${name}" defaultValue must be a number.`]
  }
  if (field.integer && !Number.isInteger(field.defaultValue)) {
    return [
      `${where}: number field "${name}" defaultValue must be an integer when integer is true.`,
    ]
  }
  return []
}

function validateNumberDefaultValue(where: string, name: string, field: NumberField): string[] {
  if (field.defaultValue === undefined) return []
  return field.hasMany
    ? validateNumberArrayDefaultValue(where, name, field)
    : validateNumberScalarDefaultValue(where, name, field)
}

function validateNumberBounds(where: string, name: string, field: NumberField): string[] {
  const issues: string[] = []
  if (field.min !== undefined && (typeof field.min !== 'number' || Number.isNaN(field.min))) {
    issues.push(`${where}: number field "${name}" min must be a valid number.`)
  }
  if (field.max !== undefined && (typeof field.max !== 'number' || Number.isNaN(field.max))) {
    issues.push(`${where}: number field "${name}" max must be a valid number.`)
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    issues.push(
      `${where}: number field "${name}" min (${field.min}) cannot be greater than max (${field.max}).`,
    )
  }
  return issues
}

function validateNumberField(where: string, name: string, field: NumberField): string[] {
  return [
    ...validateNumberBounds(where, name, field),
    ...validateHasManyRowOptions(
      where,
      name,
      'number',
      field.hasMany,
      field.minRows,
      field.maxRows,
    ),
    ...validateNumberDefaultValue(where, name, field),
  ]
}

function validateTextField(
  where: string,
  name: string,
  field: TextField,
  dbAdapter?: DatabaseAdapter,
): string[] {
  return [
    ...(field.hasMany ? [] : validateTextMaxLength(where, name, field.maxLength, dbAdapter)),
    ...validateTextMinLength(where, name, field.minLength, field.maxLength),
    ...validateHasManyRowOptions(where, name, 'text', field.hasMany, field.minRows, field.maxRows),
    ...validateTextDefaultValue(where, name, field),
  ]
}

function validateTextareaField(where: string, name: string, field: TextareaField): string[] {
  const issues: string[] = []
  if (field.maxLength !== undefined) {
    if (!Number.isInteger(field.maxLength) || field.maxLength <= 0) {
      issues.push(`${where}: textarea field "${name}" maxLength must be a positive integer.`)
    }
  }
  if (field.minLength !== undefined) {
    if (!Number.isInteger(field.minLength) || field.minLength < 0) {
      issues.push(`${where}: textarea field "${name}" minLength must be a non-negative integer.`)
    } else if (field.maxLength !== undefined && field.minLength > field.maxLength) {
      issues.push(
        `${where}: textarea field "${name}" minLength (${field.minLength}) cannot be greater than maxLength (${field.maxLength}).`,
      )
    }
  }
  return issues
}

function validateCodeField(where: string, name: string, field: CodeField): string[] {
  const issues: string[] = []
  if (field.maxLength !== undefined) {
    if (!Number.isInteger(field.maxLength) || field.maxLength <= 0 || field.maxLength > 65535) {
      issues.push(
        `${where}: code field "${name}" maxLength must be a positive integer up to 65535.`,
      )
    }
  }
  if (field.minLength !== undefined) {
    if (!Number.isInteger(field.minLength) || field.minLength < 0) {
      issues.push(`${where}: code field "${name}" minLength must be a non-negative integer.`)
    } else if (field.maxLength !== undefined && field.minLength > field.maxLength) {
      issues.push(
        `${where}: code field "${name}" minLength (${field.minLength}) cannot be greater than maxLength (${field.maxLength}).`,
      )
    }
  }
  return issues
}

function validateJsonField(where: string, name: string, field: JsonField): string[] {
  const issues: string[] = []
  if (field.maxBytes !== undefined) {
    if (!Number.isInteger(field.maxBytes) || field.maxBytes <= 0 || field.maxBytes > 1048576) {
      issues.push(
        `${where}: json field "${name}" maxBytes must be a positive integer up to 1048576 (1 MB).`,
      )
    }
  }
  return issues
}

function validateRadioField(where: string, name: string, field: RadioField): string[] {
  const issues: string[] = []
  if (!Array.isArray(field.options) || field.options.length === 0) {
    issues.push(`${where}: radio field "${name}" must have a non-empty options array.`)
  }
  if (field.layout !== undefined && field.layout !== 'horizontal' && field.layout !== 'vertical') {
    issues.push(`${where}: radio field "${name}" layout must be either "horizontal" or "vertical".`)
  }
  return issues
}

function validatePointCoordinates(
  where: string,
  name: string,
  defaultValue: [unknown, unknown],
): string[] {
  const issues: string[] = []
  const [lng, lat] = defaultValue
  if (typeof lng !== 'number' || Number.isNaN(lng) || lng < -180 || lng > 180) {
    issues.push(
      `${where}: point field "${name}" defaultValue longitude must be a number between -180 and 180.`,
    )
  }
  if (typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90) {
    issues.push(
      `${where}: point field "${name}" defaultValue latitude must be a number between -90 and 90.`,
    )
  }
  return issues
}

function validatePointField(where: string, name: string, field: PointField): string[] {
  if (field.defaultValue === undefined) return []
  if (!Array.isArray(field.defaultValue) || field.defaultValue.length !== 2) {
    return [
      `${where}: point field "${name}" defaultValue must be a 2-element tuple [longitude, latitude].`,
    ]
  }
  return validatePointCoordinates(where, name, field.defaultValue)
}

function validateSlug(slug: string, kind = 'Collection'): string[] {
  if (!SLUG.test(slug)) {
    return [
      `${kind} slug "${slug}" must be kebab-case: lowercase letters, digits and hyphens, starting with a letter.`,
    ]
  }
  const identifier = slugToIdentifier(slug)
  if (RESERVED_SLUGS.has(slug) || RESERVED_IDENTIFIERS.has(identifier)) {
    return [`${kind} slug "${slug}" is reserved.`]
  }
  return []
}

function validateFieldName(
  where: string,
  name: string,
  isUpload = false,
  hasVersions = false,
): string[] {
  if (!FIELD_NAME.test(name)) {
    return [
      `${where}: field name "${name}" must start with a letter or underscore and contain only letters, digits and underscores.`,
    ]
  }
  if (name.includes('__')) {
    return [
      `${where}: field name "${name}" cannot contain "__" (reserved as the group-column separator).`,
    ]
  }
  if (SYSTEM_FIELD_NAMES.has(name)) {
    return [`${where}: field name "${name}" is reserved for a system field.`]
  }
  if (isUpload && UPLOAD_SYSTEM_FIELD_NAMES.has(name)) {
    return [`${where}: field name "${name}" is reserved for an upload collection field.`]
  }
  if (hasVersions && name === 'versions') {
    return [`${where}: field name "versions" is reserved when versions are enabled.`]
  }
  return []
}

function validatePreview(where: string, preview: unknown): string[] {
  if (preview === undefined) return []
  if (typeof preview !== 'object' || preview === null || Array.isArray(preview)) {
    return [`${where}: admin.preview must be an object.`]
  }
  const obj = preview as Record<string, unknown>
  if (typeof obj.url !== 'string' || obj.url.trim() === '') {
    return [`${where}: admin.preview.url must be a non-empty string.`]
  }
  return []
}

function validateAdmin(where: string, collection: CollectionConfig): string[] {
  const known = new Set<string>([
    ...SYSTEM_FIELDS,
    ...(collection.upload ? UPLOAD_SYSTEM_FIELDS : []),
    ...Object.keys(flattenFields(collection.fields)),
  ])
  const { useAsTitle, defaultColumns = [] } = collection.admin ?? {}
  const check = (option: string) => (name: string) =>
    known.has(name) ? [] : [`${where}: admin.${option} refers to unknown field "${name}".`]

  return [
    ...(useAsTitle === undefined ? [] : check('useAsTitle')(useAsTitle)),
    ...defaultColumns.flatMap(check('defaultColumns')),
    ...validatePreview(where, collection.admin?.preview),
    ...validateActions(where, collection.admin?.actions, collection.endpoints, false),
  ]
}

function validateAccess(where: string, collection: CollectionConfig): string[] {
  if (!collection.access) return []
  const ops = ['read', 'create', 'update', 'delete'] as const
  const issues: string[] = []
  for (const op of ops) {
    const fn = collection.access[op]
    if (fn !== undefined && typeof fn !== 'function') {
      issues.push(`${where}: access.${op} must be a function.`)
    }
  }
  return issues
}

function validateGlobalAccess(where: string, global: GlobalConfig): string[] {
  if (!global.access) return []
  const ops = ['read', 'update'] as const
  const issues: string[] = []
  for (const op of ops) {
    const fn = global.access[op]
    if (fn !== undefined && typeof fn !== 'function') {
      issues.push(`${where}: access.${op} must be a function.`)
    }
  }
  return issues
}

const VALID_WEBHOOK_EVENTS = new Set([
  'publish',
  'unpublish',
  'create',
  'update',
  'delete',
  'change',
])

function isValidHttpUrl(str: string): boolean {
  try {
    const parsed = new URL(str)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function validateWebhookEvents(where: string, idx: number, events: unknown): string[] {
  if (!Array.isArray(events) || events.length === 0) {
    return [`${where}: webhooks[${idx}].events must be a non-empty array.`]
  }
  const issues: string[] = []
  for (const evt of events) {
    if (typeof evt !== 'string' || !VALID_WEBHOOK_EVENTS.has(evt)) {
      issues.push(`${where}: webhooks[${idx}].events contains invalid event "${String(evt)}".`)
    }
  }
  return issues
}

function validateWebhookCommon(where: string, idx: number, item: unknown): string[] {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return [`${where}: webhooks[${idx}] must be an object.`]
  }
  const obj = item as Record<string, unknown>
  const issues: string[] = []

  if (typeof obj.url !== 'string' || !isValidHttpUrl(obj.url)) {
    issues.push(`${where}: webhooks[${idx}].url must be a valid http or https URL.`)
  }

  issues.push(...validateWebhookEvents(where, idx, obj.events))

  if (obj.secret !== undefined && typeof obj.secret !== 'string') {
    issues.push(`${where}: webhooks[${idx}].secret must be a string.`)
  }

  if (obj.includeDoc !== undefined && typeof obj.includeDoc !== 'boolean') {
    issues.push(`${where}: webhooks[${idx}].includeDoc must be a boolean.`)
  }

  return issues
}

function validateRootWebhookCollections(
  idx: number,
  collections: unknown,
  collectionMap: Map<string, CollectionConfig>,
): string[] {
  if (collections === undefined || collections === '*') return []
  if (!Array.isArray(collections) || collections.length === 0) {
    return [
      `Config: webhooks[${idx}].collections must be '*' or a non-empty array of collection slugs.`,
    ]
  }
  const issues: string[] = []
  for (const slug of collections) {
    if (typeof slug !== 'string' || !collectionMap.has(slug)) {
      issues.push(
        `Config: webhooks[${idx}].collections refers to unknown collection "${String(slug)}".`,
      )
    }
  }
  return issues
}

function validateRootWebhookGlobals(
  idx: number,
  globalsOption: unknown,
  globals?: readonly GlobalConfig[],
): string[] {
  if (globalsOption === undefined || globalsOption === '*') return []
  const globalMap = new Set((globals ?? []).map((g) => g.slug))
  if (!Array.isArray(globalsOption) || globalsOption.length === 0) {
    return [`Config: webhooks[${idx}].globals must be '*' or a non-empty array of global slugs.`]
  }
  const issues: string[] = []
  for (const slug of globalsOption) {
    if (typeof slug !== 'string' || !globalMap.has(slug)) {
      issues.push(`Config: webhooks[${idx}].globals refers to unknown global "${String(slug)}".`)
    }
  }
  return issues
}

function validateRootWebhooks(
  webhooks: unknown,
  collectionMap: Map<string, CollectionConfig>,
  globals?: readonly GlobalConfig[],
): string[] {
  if (webhooks === undefined) return []
  if (!Array.isArray(webhooks)) {
    return ['Config: webhooks must be an array.']
  }
  const list = webhooks as readonly unknown[]
  const issues: string[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    issues.push(...validateWebhookCommon('Config', i, item))
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>
      issues.push(...validateRootWebhookCollections(i, obj.collections, collectionMap))
      issues.push(...validateRootWebhookGlobals(i, obj.globals, globals))
    }
  }
  return issues
}

function validateScopedWebhooks(where: string, webhooks: unknown): string[] {
  if (webhooks === undefined) return []
  if (!Array.isArray(webhooks)) {
    return [`${where}: webhooks must be an array.`]
  }
  const list = webhooks as readonly unknown[]
  const issues: string[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    issues.push(...validateWebhookCommon(where, i, item))
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>
      if (obj.collections !== undefined) {
        issues.push(`${where}: webhooks[${i}] cannot specify "collections".`)
      }
      if (obj.globals !== undefined) {
        issues.push(`${where}: webhooks[${i}] cannot specify "globals".`)
      }
    }
  }
  return issues
}
