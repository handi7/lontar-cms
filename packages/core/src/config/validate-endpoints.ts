import type { CollectionConfig, Config, Endpoint } from './types'

/** First segments of root routes that built-in routes own (ADR 0029). */
export const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set(['auth', 'globals', '_lontar'])
/** Static segment of a collection route (`/:collection/file/...`) that a custom path must not start with. */
export const RESERVED_COLLECTION_FIRST_SEGMENTS: ReadonlySet<string> = new Set(['file'])
/** Static segments after `/:id` that built-in collection routes own. */
export const RESERVED_DOCUMENT_SEGMENTS: ReadonlySet<string> = new Set([
  'versions',
  'publish',
  'unpublish',
])
/** Static segments after `/globals/:slug` that built-in global routes own. */
export const RESERVED_GLOBAL_SEGMENTS: ReadonlySet<string> = new Set([
  'versions',
  'publish',
  'unpublish',
])

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/
const STATIC_SEGMENT = /^[A-Za-z0-9_-]+$/
const PARAM_SEGMENT = /^:[A-Za-z_][A-Za-z0-9_]*$/

function isParam(segment: string): boolean {
  return PARAM_SEGMENT.test(segment)
}

function isNumeric(segment: string): boolean {
  return /^\d+$/.test(segment)
}

function validatePathShape(where: string, path: string): { issues: string[]; segments: string[] } {
  if (!path.startsWith('/') || path === '/' || path.endsWith('/')) {
    return {
      issues: [
        `${where}: path "${path}" must start with "/", name at least one segment and not end with "/".`,
      ],
      segments: [],
    }
  }
  const segments = path.slice(1).split('/')
  const bad = segments.find((s) => !STATIC_SEGMENT.test(s) && !isParam(s))
  if (bad !== undefined) {
    return {
      issues: [
        `${where}: path "${path}" has an invalid segment "${bad}". Use static segments or ":param" names; wildcards and regular expressions are not supported.`,
      ],
      segments: [],
    }
  }
  return { issues: [], segments }
}

function validateRootPath(
  where: string,
  path: string,
  segments: string[],
  collectionSlugs: ReadonlySet<string>,
): string[] {
  const first = segments[0] ?? ''
  if (isParam(first)) {
    return [`${where}: path "${path}" starts with a parameter, which would match built-in routes.`]
  }
  if (RESERVED_ROOT_SEGMENTS.has(first)) {
    return [`${where}: path "${path}" overlaps the built-in "/${first}" routes.`]
  }
  if (collectionSlugs.has(first)) {
    return [`${where}: path "${path}" overlaps the routes of collection "${first}".`]
  }
  return []
}

function validateCollectionPath(where: string, path: string, segments: string[]): string[] {
  const first = segments[0] ?? ''
  if (first === ':id') {
    const second = segments[1]
    if (second === undefined || isParam(second)) {
      return [`${where}: path "${path}" must follow "/:id" with a static segment.`]
    }
    if (RESERVED_DOCUMENT_SEGMENTS.has(second)) {
      return [`${where}: path "${path}" overlaps the built-in "/:id/${second}" route.`]
    }
    return []
  }
  if (isParam(first)) {
    return [`${where}: path "${path}" may only start with the ":id" parameter.`]
  }
  if (isNumeric(first)) {
    return [`${where}: path "${path}" starts with a number, which would match a document id.`]
  }
  if (RESERVED_COLLECTION_FIRST_SEGMENTS.has(first)) {
    return [`${where}: path "${path}" overlaps the built-in "/${first}" route.`]
  }
  return []
}

function validateGlobalPath(where: string, path: string, segments: string[]): string[] {
  const first = segments[0] ?? ''
  if (RESERVED_GLOBAL_SEGMENTS.has(first)) {
    return [`${where}: path "${path}" overlaps the built-in "/${first}" route.`]
  }
  return []
}

function validateRateLimit(where: string, rateLimit: unknown): string[] {
  if (rateLimit === undefined) return []
  const message = `${where}: rateLimit needs positive integer "window" (seconds) and "max".`
  if (typeof rateLimit !== 'object' || rateLimit === null) return [message]
  const { window, max } = rateLimit as { window?: unknown; max?: unknown }
  const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0
  return ok(window) && ok(max) ? [] : [message]
}

function validateEndpointFields(where: string, endpoint: Endpoint): string[] {
  const issues: string[] = []
  if (typeof endpoint.name !== 'string' || !NAME.test(endpoint.name)) {
    issues.push(`${where}: name must start with a letter and use letters, digits, "_" or "-".`)
  }
  if (!METHODS.has(endpoint.method)) {
    issues.push(`${where}: method must be one of get, post, put, patch, delete.`)
  }
  if (typeof endpoint.handler !== 'function') issues.push(`${where}: handler must be a function.`)
  if (endpoint.access !== undefined && typeof endpoint.access !== 'function') {
    issues.push(`${where}: access must be a function.`)
  }
  if (endpoint.apiKey !== undefined && typeof endpoint.apiKey !== 'boolean') {
    issues.push(`${where}: apiKey must be a boolean.`)
  }
  issues.push(...validateRateLimit(where, endpoint.rateLimit))
  return issues
}

type Scope = 'root' | 'collection' | 'global'

function validateScopePath(
  scope: Scope,
  where: string,
  endpoint: Endpoint,
  collectionSlugs: ReadonlySet<string>,
): string[] {
  if (typeof endpoint.path !== 'string') return [`${where}: path must be a string.`]
  const { issues, segments } = validatePathShape(where, endpoint.path)
  if (issues.length > 0) return issues
  if (scope === 'root') return validateRootPath(where, endpoint.path, segments, collectionSlugs)
  if (scope === 'collection') return validateCollectionPath(where, endpoint.path, segments)
  return validateGlobalPath(where, endpoint.path, segments)
}

function validateEndpointList(
  scope: Scope,
  owner: string,
  endpoints: readonly Endpoint[] | undefined,
  collectionSlugs: ReadonlySet<string>,
): string[] {
  if (endpoints === undefined) return []
  const list: unknown = endpoints
  if (!Array.isArray(list)) return [`${owner}: endpoints must be an array.`]
  const issues: string[] = []
  const names = new Set<string>()
  const routes = new Set<string>()
  for (const [index, endpoint] of (list as readonly (Endpoint | null)[]).entries()) {
    const label = typeof endpoint?.name === 'string' ? `"${endpoint.name}"` : `#${index}`
    const where = `${owner} endpoint ${label}`
    if (typeof endpoint !== 'object' || endpoint === null) {
      issues.push(`${where}: must be an object.`)
      continue
    }
    issues.push(...validateEndpointFields(where, endpoint))
    issues.push(...validateScopePath(scope, where, endpoint, collectionSlugs))
    if (names.has(endpoint.name)) issues.push(`${where}: name is used twice in ${owner}.`)
    names.add(endpoint.name)
    const route = `${endpoint.method} ${endpoint.path}`
    if (routes.has(route)) issues.push(`${where}: "${route}" is declared twice in ${owner}.`)
    routes.add(route)
  }
  return issues
}

export function validateEndpoints(
  config: Pick<Config, 'endpoints' | 'collections' | 'globals'>,
): string[] {
  const slugs = new Set((config.collections ?? []).map((c: CollectionConfig) => c.slug))
  const issues = validateEndpointList('root', 'Config', config.endpoints, slugs)
  for (const c of config.collections ?? []) {
    issues.push(...validateEndpointList('collection', `Collection "${c.slug}"`, c.endpoints, slugs))
  }
  for (const g of config.globals ?? []) {
    issues.push(...validateEndpointList('global', `Global "${g.slug}"`, g.endpoints, slugs))
  }
  return issues
}
