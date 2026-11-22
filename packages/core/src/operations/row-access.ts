import {
  constraintOf,
  matchesConstraint,
  resolveAccess,
  type ConstrainedOperation,
} from '../access'
import type { AuthUser } from '../auth/types'
import type { AccessArgs, CollectionConfig, Config } from '../config/types'
import { AccessDeniedError, NotFoundError } from './errors'

export interface AssertRowAccessArgs {
  config: Config
  collection: CollectionConfig
  id: number
  user?: AuthUser | null
  /** Every one of these must allow the document. */
  operations: readonly ConstrainedOperation[]
  /** Passed to the access function. `id` is added. */
  data?: unknown
  locale?: string
  fallbackLocale?: string | false
  req?: Request
}

/**
 * Access for an operation on one document (ADR 0030 §5 and §6). A function that returns `false`
 * is denied, as before. A function that returns a constraint is checked against the stored row
 * with one query, and a document outside it is "not found", the same as a document that does not
 * exist, so existence does not leak.
 */
export async function assertRowAccess(args: AssertRowAccessArgs): Promise<void> {
  const user = args.user ?? null
  // Only what the caller has, so an access function sees the same arguments as before.
  const accessArgs: AccessArgs = { user, id: args.id }
  if (args.data !== undefined) accessArgs.data = args.data
  if (args.locale !== undefined) accessArgs.locale = args.locale
  if (args.req !== undefined) accessArgs.req = args.req
  const decisions = []
  for (const operation of args.operations) {
    const decision = await resolveAccess(args.collection, operation, accessArgs, args.config)
    if (!decision.allowed) throw new AccessDeniedError('Access denied', { user })
    decisions.push(decision)
  }

  const constraint = constraintOf(...decisions)
  if (!constraint) return
  const matches = await matchesConstraint({
    config: args.config,
    collection: args.collection,
    id: args.id,
    constraint,
    locale: args.locale,
    fallbackLocale: args.fallbackLocale,
  })
  if (!matches) throw new NotFoundError(`Document with ID ${args.id} not found`)
}
