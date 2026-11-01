import { SYSTEM_FIELDS } from '../client/system-fields'
import type { CollectionConfig, Config, GlobalConfig } from './types'

const SLUG = /^[a-z][a-z0-9-]*$/
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Slugs that would collide with fixed API routes or auth tables. */
const RESERVED_SLUGS = new Set(['globals', 'auth', 'user', 'session', 'account', 'verification'])
const SYSTEM_FIELD_NAMES = new Set<string>(SYSTEM_FIELDS)

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
  const collectionsResult = validateCollections(config.collections)
  issues.push(...collectionsResult.issues)
  issues.push(...validateGlobals(config.globals, collectionsResult.slugs))
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
  slugs: Set<string>
} {
  const issues: string[] = []
  const slugs = new Set<string>()
  for (const collection of collections) {
    if (slugs.has(collection.slug)) {
      issues.push(`Collection slug "${collection.slug}" is used twice.`)
    }
    slugs.add(collection.slug)
    issues.push(...validateCollection(collection))
  }
  return { issues, slugs }
}

function validateGlobals(
  globals: readonly GlobalConfig[] | undefined,
  collectionSlugs: Set<string>,
): string[] {
  if (!globals) return []
  const issues: string[] = []
  const seen = new Set<string>()
  for (const global of globals) {
    if (seen.has(global.slug)) {
      issues.push(`Global slug "${global.slug}" is used twice.`)
    }
    if (collectionSlugs.has(global.slug)) {
      issues.push(`Global slug "${global.slug}" collides with a collection slug.`)
    }
    seen.add(global.slug)
    issues.push(...validateGlobal(global))
  }
  return issues
}

function validateCollection(collection: CollectionConfig): string[] {
  const where = `Collection "${collection.slug}"`
  return [
    ...validateSlug(collection.slug, 'Collection'),
    ...Object.keys(collection.fields).flatMap((name) => validateFieldName(where, name)),
    ...validateAdmin(where, collection),
    ...validateAccess(where, collection),
  ]
}

function validateGlobal(global: GlobalConfig): string[] {
  const where = `Global "${global.slug}"`
  return [
    ...validateSlug(global.slug, 'Global'),
    ...Object.keys(global.fields).flatMap((name) => validateFieldName(where, name)),
    ...validateGlobalAccess(where, global),
  ]
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

function validateFieldName(where: string, name: string): string[] {
  if (!FIELD_NAME.test(name)) {
    return [
      `${where}: field name "${name}" must start with a letter or underscore and contain only letters, digits and underscores.`,
    ]
  }
  if (SYSTEM_FIELD_NAMES.has(name)) {
    return [`${where}: field name "${name}" is reserved for a system field.`]
  }
  return []
}

function validateAdmin(where: string, collection: CollectionConfig): string[] {
  const known = new Set<string>([...SYSTEM_FIELDS, ...Object.keys(collection.fields)])
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
