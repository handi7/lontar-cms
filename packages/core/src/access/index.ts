import type { Context } from 'hono'
import type { AuthUser } from '../auth/types'
import type { AccessArgs, AccessFunction, ConstraintAccessFunction } from '../config/types'

export const defaultAccess: AccessFunction = ({ user }) => Boolean(user)

/**
 * Boolean access check. A result that is not a boolean is denied, not read as truthy: an object
 * returned by `create`, a global or a field cannot be a constraint (ADR 0030 §1). Collection
 * `read`, `update` and `delete` that accept a constraint go through `resolveAccess` instead.
 */
export async function checkAccess(
  fn: AccessFunction | ConstraintAccessFunction | undefined,
  args: AccessArgs,
): Promise<boolean> {
  const handler = fn ?? defaultAccess
  try {
    const result = await handler(args)
    if (typeof result === 'boolean') return result
    console.warn('[lontar:access] Access function returned a non-boolean and was denied')
    return false
  } catch {
    return false
  }
}

export function accessDenied(c: Context, user: AuthUser | null): Response {
  if (user) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return c.json({ error: 'Unauthorized' }, 401)
}

export {
  combineWhere,
  constraintOf,
  findConstrained,
  matchesConstraint,
  resolveAccess,
  type AccessDecision,
  type ConstrainedOperation,
} from './constraint'
export {
  checkFieldAccess,
  createFieldAccessCache,
  getFieldAccessCache,
  sanitizeDocRead,
  sanitizeDocWrite,
  type FieldAccessCache,
  type ReadSanitizationContext,
  type WriteSanitizationContext,
} from './field-access'

export { extractReferencedPaths, isPathReadable, validateQueryAccess } from './query-access'

export {
  getDocumentPermissions,
  getGlobalPermissions,
  getPermissions,
  type CollectionPermission,
  type FieldPermission,
  type GlobalPermission,
  type PermissionsResponse,
} from './permissions'
