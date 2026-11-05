import { SYSTEM_FIELDS, UPLOAD_SYSTEM_FIELDS } from '../client/system-fields'
import type {
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
  return [
    ...validateSlug(collection.slug, 'Collection'),
    ...Object.keys(collection.fields).flatMap((name) => validateFieldName(where, name, isUpload)),
    ...Object.entries(collection.fields).flatMap(([name, field]) =>
      validateField(where, name, field, collection.fields),
    ),
    ...validatePagination(where, collection.pagination),
    ...validateAdmin(where, collection),
    ...validateAccess(where, collection),
  ]
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
  return [
    ...validateSlug(global.slug, 'Global'),
    ...Object.keys(global.fields).flatMap((name) => validateFieldName(where, name)),
    ...Object.entries(global.fields).flatMap(([name, field]) =>
      validateField(where, name, field, global.fields),
    ),
    ...validateGlobalAccess(where, global),
  ]
}

function validateField(
  where: string,
  name: string,
  field: Field,
  fields: Record<string, Field>,
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

function validateFieldName(where: string, name: string, isUpload = false): string[] {
  if (!FIELD_NAME.test(name)) {
    return [
      `${where}: field name "${name}" must start with a letter or underscore and contain only letters, digits and underscores.`,
    ]
  }
  if (SYSTEM_FIELD_NAMES.has(name)) {
    return [`${where}: field name "${name}" is reserved for a system field.`]
  }
  if (isUpload && UPLOAD_SYSTEM_FIELD_NAMES.has(name)) {
    return [`${where}: field name "${name}" is reserved for an upload collection field.`]
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
