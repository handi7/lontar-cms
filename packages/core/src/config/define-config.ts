import { SYSTEM_FIELDS, UPLOAD_SYSTEM_FIELDS } from '../client/system-fields'
import type {
  ArrayField,
  Block,
  BlocksField,
  Field,
  RelationshipField,
  SlugField,
  TextareaField,
  TextField,
  UploadField,
} from '../fields/types'
import type { CollectionConfig, Config, GlobalConfig, PaginationConfig } from './types'

const SLUG = /^[a-z][a-z0-9-]*$/
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Slugs that would collide with fixed API routes or auth tables. */
const RESERVED_SLUGS = new Set(['globals', 'auth', 'user', 'session', 'account', 'verification'])
const SYSTEM_FIELD_NAMES = new Set<string>(SYSTEM_FIELDS)
const UPLOAD_SYSTEM_FIELD_NAMES = new Set<string>(UPLOAD_SYSTEM_FIELDS)
const TEXT_LIKE_FIELD_TYPES = new Set(['text', 'textarea', 'email', 'select'])
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
  return config
}

function validateConfig(config: Config): string[] {
  const issues = validateSecret(config.secret)
  issues.push(...validatePagination('Config', config.pagination))
  const { issues: collectionIssues, collectionMap } = validateCollections(config.collections)
  issues.push(...collectionIssues)
  issues.push(...validateGlobals(config.globals, collectionMap))
  issues.push(...validateStorage(config))
  issues.push(...validateRootWebhooks(config.webhooks, collectionMap, config.globals))
  return issues
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

function validateCollections(collections: readonly CollectionConfig[]): {
  issues: string[]
  collectionMap: Map<string, CollectionConfig>
} {
  const issues: string[] = []
  const slugs = new Set<string>()
  const collectionMap = new Map<string, CollectionConfig>()
  for (const collection of collections) {
    if (slugs.has(collection.slug)) {
      issues.push(`Collection slug "${collection.slug}" is used twice.`)
    }
    slugs.add(collection.slug)
    collectionMap.set(collection.slug, collection)
    issues.push(...validateCollection(collection))
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
): string[] {
  if (!globals) return []
  const issues: string[] = []
  const seen = new Set<string>()
  for (const global of globals) {
    if (seen.has(global.slug)) {
      issues.push(`Global slug "${global.slug}" is used twice.`)
    }
    if (collectionMap.has(global.slug)) {
      issues.push(`Global slug "${global.slug}" collides with a collection slug.`)
    }
    seen.add(global.slug)
    issues.push(...validateGlobal(global))
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
  for (const [name, field] of Object.entries(fields)) {
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

function validateCollection(collection: CollectionConfig): string[] {
  const where = `Collection "${collection.slug}"`
  const isUpload = Boolean(collection.upload)
  const hasVersions = Boolean(collection.versions)
  return [
    ...validateSlug(collection.slug, 'Collection'),
    ...validateFields(where, collection.fields, isUpload, 1, hasVersions),
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

function validateGlobal(global: GlobalConfig): string[] {
  const where = `Global "${global.slug}"`
  const hasVersions = Boolean(global.versions)
  return [
    ...validateSlug(global.slug, 'Global'),
    ...validateFields(where, global.fields, false, 1, hasVersions),
    ...validateVersions(where, global.versions),
    ...validatePreview(where, global.admin?.preview),
    ...validateGlobalAccess(where, global),
    ...validateScopedWebhooks(where, global.webhooks),
  ]
}

function validateFields(
  where: string,
  fields: Record<string, Field>,
  isUpload: boolean,
  depth: number,
  hasVersions = false,
): string[] {
  const issues: string[] = []
  for (const [name, field] of Object.entries(fields)) {
    issues.push(
      ...validateFieldName(where, name, depth === 1 && isUpload, depth === 1 && hasVersions),
    )
    if (depth > 1 && name === 'id') {
      issues.push(`${where}: field name "id" is reserved.`)
    }
    issues.push(...validateField(where, name, field, fields, depth))
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
      ),
    )
  }
  return issues
}

function validateField(
  where: string,
  name: string,
  field: Field,
  fields: Record<string, Field>,
  depth: number,
): string[] {
  if (field.type === 'text') {
    return validateTextField(where, name, field)
  }
  if (field.type === 'textarea') {
    return validateTextareaField(where, name, field)
  }
  if (field.type === 'slug') {
    return validateSlugField(where, name, field, fields)
  }
  if (field.type === 'group') {
    return [
      ...validateGroupField(where, name, depth),
      ...validateFields(`${where} -> group "${name}"`, field.fields, false, depth + 1),
    ]
  }
  if (field.type === 'array') {
    return [
      ...validateArrayField(where, name, field, depth),
      ...validateFields(`${where} -> array "${name}"`, field.fields, false, depth + 1),
    ]
  }
  if (field.type === 'blocks') {
    return [
      ...validateBlocksField(where, name, field, depth),
      ...validateBlocksContent(where, name, field, depth),
    ]
  }
  return []
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

function validateTextField(where: string, name: string, field: TextField): string[] {
  const issues: string[] = []
  if (field.maxLength !== undefined) {
    if (!Number.isInteger(field.maxLength) || field.maxLength <= 0) {
      issues.push(`${where}: text field "${name}" maxLength must be a positive integer.`)
    } else if (field.maxLength > MAX_VARCHAR_LENGTH) {
      issues.push(
        `${where}: text field "${name}" maxLength (${field.maxLength}) exceeds MySQL VARCHAR limit of ${MAX_VARCHAR_LENGTH}. Use a textarea field for longer text.`,
      )
    }
  }
  if (field.minLength !== undefined) {
    if (!Number.isInteger(field.minLength) || field.minLength < 0) {
      issues.push(`${where}: text field "${name}" minLength must be a non-negative integer.`)
    } else if (field.maxLength !== undefined && field.minLength > field.maxLength) {
      issues.push(
        `${where}: text field "${name}" minLength (${field.minLength}) cannot be greater than maxLength (${field.maxLength}).`,
      )
    }
  }
  return issues
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

function validateSlug(slug: string, kind = 'Collection'): string[] {
  if (!SLUG.test(slug)) {
    return [
      `${kind} slug "${slug}" must be kebab-case: lowercase letters, digits and hyphens, starting with a letter.`,
    ]
  }
  if (RESERVED_SLUGS.has(slug)) return [`${kind} slug "${slug}" is reserved.`]
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
    ...Object.keys(collection.fields),
  ])
  const { useAsTitle, defaultColumns = [] } = collection.admin ?? {}
  const check = (option: string) => (name: string) =>
    known.has(name) ? [] : [`${where}: admin.${option} refers to unknown field "${name}".`]

  return [
    ...(useAsTitle === undefined ? [] : check('useAsTitle')(useAsTitle)),
    ...defaultColumns.flatMap(check('defaultColumns')),
    ...validatePreview(where, collection.admin?.preview),
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
