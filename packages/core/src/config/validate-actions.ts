import type { ActionConfig, ActionScope, ActionVariant, Endpoint } from './types'

const VALID_SCOPES = new Set<ActionScope>(['row', 'document', 'bulk'])
const VALID_VARIANTS = new Set<ActionVariant>([
  'default',
  'destructive',
  'secondary',
  'outline',
  'ghost',
  'link',
])
const ACTION_KEY_REGEX = /^[a-zA-Z0-9_-]+$/

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function validateKeyAndLabel(
  prefix: string,
  key: unknown,
  label: unknown,
  seenKeys: Set<string>,
  issues: string[],
): void {
  if (!isNonEmptyString(key) || !ACTION_KEY_REGEX.test(key)) {
    issues.push(
      `${prefix}: key must be a non-empty string of letters, digits, hyphens or underscores.`,
    )
  } else if (seenKeys.has(key)) {
    issues.push(`${prefix}: duplicate action key "${key}".`)
  } else {
    seenKeys.add(key)
  }

  if (!isNonEmptyString(label)) {
    issues.push(`${prefix}: label must be a non-empty string.`)
  }
}

function validateGlobalScope(prefix: string, scope: unknown, issues: string[]): void {
  if (scope === undefined) return
  const scopes = Array.isArray(scope) ? scope : [scope]
  for (const s of scopes) {
    if (s !== 'document') {
      issues.push(`${prefix}: global actions only support "document" scope.`)
    }
  }
}

function validateCollectionScope(prefix: string, scope: unknown, issues: string[]): void {
  if (scope === undefined) {
    issues.push(`${prefix}: scope must be specified ("row", "document", or "bulk").`)
    return
  }
  const scopes = Array.isArray(scope) ? scope : [scope]
  if (scopes.length === 0) {
    issues.push(`${prefix}: scope must contain at least one valid scope.`)
    return
  }
  for (const s of scopes) {
    if (typeof s !== 'string' || !VALID_SCOPES.has(s as ActionScope)) {
      issues.push(`${prefix}: invalid scope "${String(s)}". Must be "row", "document", or "bulk".`)
    }
  }
}

interface ValidateTargetParams {
  prefix: string
  where: string
  key: unknown
  index: number
  endpoint: unknown
  component: unknown
  endpoints: readonly Endpoint[] | undefined
  issues: string[]
}

function validateEndpointTarget(params: ValidateTargetParams): void {
  const { prefix, where, key, index, endpoint, endpoints, issues } = params
  if (!isNonEmptyString(endpoint)) {
    issues.push(`${prefix}: endpoint must be a non-empty string.`)
    return
  }
  const found = endpoints?.some((e) => e.name === endpoint)
  if (!found) {
    const actionId = typeof key === 'string' && key.trim() ? key : String(index)
    issues.push(`${where}: action "${actionId}" refers to unknown endpoint "${endpoint}".`)
  }
}

function validateTarget(params: ValidateTargetParams): void {
  const { prefix, endpoint, component, issues } = params
  if (endpoint !== undefined && component !== undefined) {
    issues.push(`${prefix}: specify either "endpoint" or "component", not both.`)
  } else if (endpoint === undefined && component === undefined) {
    issues.push(`${prefix}: must specify either "endpoint" or "component".`)
  } else if (endpoint !== undefined) {
    validateEndpointTarget(params)
  } else if (component !== undefined && !isNonEmptyString(component)) {
    issues.push(`${prefix}: component must be a non-empty string.`)
  }
}

function validateOptions(
  prefix: string,
  confirm: unknown,
  variant: unknown,
  issues: string[],
): void {
  if (confirm !== undefined && (typeof confirm !== 'string' || confirm.trim() === '')) {
    issues.push(`${prefix}: confirm must be a non-empty string.`)
  }

  if (variant !== undefined) {
    const isString = typeof variant === 'string'
    if (!isString || !VALID_VARIANTS.has(variant as ActionVariant)) {
      const variantStr = isString ? variant : ''
      issues.push(`${prefix}: variant "${variantStr}" is invalid.`)
    }
  }
}

export function validateAction(
  action: unknown,
  index: number,
  where: string,
  endpoints: readonly Endpoint[] | undefined,
  isGlobal: boolean,
  seenKeys: Set<string>,
): string[] {
  const prefix = `${where}: admin.actions[${index}]`
  if (typeof action !== 'object' || action === null || Array.isArray(action)) {
    return [`${prefix} must be an object.`]
  }

  const { key, label, scope, endpoint, component, confirm, variant } = action as Record<
    string,
    unknown
  >
  const issues: string[] = []

  validateKeyAndLabel(prefix, key, label, seenKeys, issues)

  if (isGlobal) {
    validateGlobalScope(prefix, scope, issues)
  } else {
    validateCollectionScope(prefix, scope, issues)
  }

  validateTarget({ prefix, where, key, index, endpoint, component, endpoints, issues })
  validateOptions(prefix, confirm, variant, issues)

  return issues
}

export function validateActions(
  where: string,
  actions: readonly ActionConfig[] | undefined,
  endpoints: readonly Endpoint[] | undefined,
  isGlobal = false,
): string[] {
  if (actions === undefined) return []
  if (!Array.isArray(actions)) return [`${where}: admin.actions must be an array.`]

  const seenKeys = new Set<string>()
  return actions.flatMap((action, index) =>
    validateAction(action, index, where, endpoints, isGlobal, seenKeys),
  )
}
