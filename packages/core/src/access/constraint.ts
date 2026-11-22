import type {
  AccessArgs,
  CollectionConfig,
  Config,
  ConstraintAccessFunction,
} from '../config/types'
import type { StoredDoc } from '../database/adapter'
import type { Where } from '../query/types'
import { validateWhere } from '../query/validator'
import { defaultAccess } from './index'

export type ConstrainedOperation = 'read' | 'update' | 'delete'

/** The outcome of a row-level access check: nothing, or everything the constraint allows. */
export type AccessDecision = { allowed: false } | { allowed: true; constraint?: Where }

const DENIED: AccessDecision = { allowed: false }

function isPlainObject(value: unknown): value is Where {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function deny(collection: CollectionConfig, operation: string, reason: string): AccessDecision {
  console.warn(`[lontar:access] ${collection.slug}.${operation} denied: ${reason}`)
  return DENIED
}

// An empty group matches nothing sensibly and everything dangerously (ADR 0030 §2).
function isEmptyConstraint(where: Where): boolean {
  const keys = Object.keys(where).filter((key) => where[key] !== undefined)
  if (keys.length === 0) return true
  return keys.every((key) => (key === 'and' || key === 'or') && isEmptyGroup(where[key]))
}

function isEmptyGroup(group: unknown): boolean {
  return (
    Array.isArray(group) && group.every((item) => isPlainObject(item) && isEmptyConstraint(item))
  )
}

function checkConstraint(
  constraint: Where,
  collection: CollectionConfig,
  operation: ConstrainedOperation,
  config: Config,
): AccessDecision {
  if (isEmptyConstraint(constraint)) {
    return deny(
      collection,
      operation,
      'the constraint is empty; return true to allow every document',
    )
  }
  const issues = validateWhere(constraint, collection, config.localization)
  if (issues.length > 0) {
    const detail = issues.map((issue) => issue.message).join('; ')
    return deny(collection, operation, `the constraint is invalid (${detail})`)
  }
  return { allowed: true, constraint }
}

/**
 * Runs a collection's `read`, `update` or `delete` access function and reads the result as a
 * decision. A boolean allows or denies as before. A plain object is a constraint, validated like a
 * request's `where`. Anything else, an empty or invalid constraint, and a function that throws
 * are denied (ADR 0030 §1 to §3).
 */
export async function resolveAccess(
  collection: CollectionConfig,
  operation: ConstrainedOperation,
  args: AccessArgs,
  config: Config,
): Promise<AccessDecision> {
  const handler: ConstraintAccessFunction = collection.access?.[operation] ?? defaultAccess
  let result: unknown
  try {
    result = await handler(args)
  } catch (err) {
    console.warn('[lontar:access] Access function threw an error:', err)
    return DENIED
  }
  if (typeof result === 'boolean') return result ? { allowed: true } : DENIED
  if (isPlainObject(result)) return checkConstraint(result, collection, operation, config)
  return deny(
    collection,
    operation,
    'the access function returned neither a boolean nor a constraint',
  )
}

/** `and`s constraints with a request's own filter. Absent parts are skipped. */
export function combineWhere(...parts: Array<Where | undefined>): Where | undefined {
  const present = parts.filter((part): part is Where => part !== undefined)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]
  return { and: present }
}

/** The constraints of several decisions that all must allow, as one `Where`. */
export function constraintOf(...decisions: AccessDecision[]): Where | undefined {
  return combineWhere(
    ...decisions.map((decision) => (decision.allowed ? decision.constraint : undefined)),
  )
}

export interface FindConstrainedArgs {
  config: Config
  collection: CollectionConfig
  id: number
  constraint: Where | undefined
  locale?: string
  fallbackLocale?: string | false
}

/**
 * Reads one document by id, but only when it satisfies the constraint. It is a query, so the
 * constraint means here what it means in a list. `null` is returned for a missing document and
 * for one outside the constraint alike (ADR 0030 §5 and §6).
 */
export async function findConstrained(args: FindConstrainedArgs): Promise<StoredDoc | null> {
  if (!args.constraint) {
    return args.config.db.findByID({
      collection: args.collection,
      id: args.id,
      locale: args.locale,
      fallbackLocale: args.fallbackLocale,
    })
  }
  const result = await args.config.db.find({
    collection: args.collection,
    where: { and: [{ id: { equals: args.id } }, args.constraint] },
    page: 1,
    limit: 1,
    locale: args.locale,
    fallbackLocale: args.fallbackLocale,
  })
  return result.docs[0] ?? null
}

/** Whether the document exists and satisfies the constraint. */
export async function matchesConstraint(args: FindConstrainedArgs): Promise<boolean> {
  return (await findConstrained(args)) !== null
}
