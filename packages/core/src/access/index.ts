import type { Context } from 'hono'
import type { AuthUser } from '../auth/types'
import type { AccessArgs, AccessFunction } from '../config/types'

export const defaultAccess: AccessFunction = ({ user }) => Boolean(user)

export async function checkAccess(
  fn: AccessFunction | undefined,
  args: AccessArgs,
): Promise<boolean> {
  const handler = fn ?? defaultAccess
  try {
    const result = await handler(args)
    return Boolean(result)
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
