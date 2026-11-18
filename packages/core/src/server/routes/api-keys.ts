import type { Context, Hono } from 'hono'
import { z } from 'zod'
import {
  createApiKey,
  getApiKeyById,
  listApiKeys,
  MAX_TIMESTAMP_MS,
  revokeApiKey,
} from '../../auth/api-key'
import type { Auth, AuthUser, LontarVariables } from '../../auth/types'
import { getUserById } from '../../auth/user'
import type { Config } from '../../config/types'

type LontarEnv = { Variables: LontarVariables }

export const createApiKeyBodySchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(255, 'Name must be 255 characters or fewer'),
  expiresIn: z
    .number({ error: 'expiresIn must be a positive integer' })
    .int('expiresIn must be an integer')
    .positive('expiresIn must be a positive integer')
    .refine((val) => Date.now() + val * 1000 <= MAX_TIMESTAMP_MS, {
      message: 'expiresIn must not exceed 2038-01-19T03:14:07Z',
    })
    .nullable()
    .optional(),
  userId: z
    .string({ error: 'userId must be a string' })
    .min(1, 'userId cannot be empty')
    .optional(),
})

export type CreateApiKeyValidatedData = z.infer<typeof createApiKeyBodySchema>

function checkAuthAccess(c: Context<LontarEnv>): {
  user?: AuthUser
  errorResponse?: Response
} {
  if (c.get('apiKey')) {
    return { errorResponse: c.json({ error: 'Forbidden' }, 403) }
  }
  const user = c.get('user')
  if (!user) {
    return { errorResponse: c.json({ error: 'Unauthorized' }, 401) }
  }
  return { user }
}

function resolveTargetUserId(
  c: Context<LontarEnv>,
  currentUser: AuthUser,
  requestedUserId?: string,
  adminRole = 'admin',
): { targetUserId?: string; errorResponse?: Response } {
  if (!requestedUserId || requestedUserId === currentUser.id) {
    return { targetUserId: currentUser.id }
  }
  if (currentUser.role !== adminRole) {
    return { errorResponse: c.json({ error: 'Forbidden' }, 403) }
  }
  return { targetUserId: requestedUserId }
}

async function parseCreateBody(
  c: Context<LontarEnv>,
): Promise<{ data?: CreateApiKeyValidatedData; errorResponse?: Response }> {
  let raw: unknown
  try {
    raw = await c.req.json<unknown>()
  } catch {
    return { errorResponse: c.json({ error: 'Invalid JSON body' }, 400) }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errorResponse: c.json({ error: 'Invalid JSON body' }, 400) }
  }

  const result = createApiKeyBodySchema.safeParse(raw)
  if (!result.success) {
    const firstIssue = result.error.issues[0]
    return {
      errorResponse: c.json({ error: firstIssue?.message ?? 'Validation failed' }, 400),
    }
  }

  return { data: result.data }
}

async function handleListApiKeys(
  c: Context<LontarEnv>,
  auth: Auth,
  adminRole: string,
): Promise<Response> {
  const authCheck = checkAuthAccess(c)
  if (authCheck.errorResponse || !authCheck.user) {
    return authCheck.errorResponse!
  }

  const requestedUserId = c.req.query('userId')
  const userResolution = resolveTargetUserId(c, authCheck.user, requestedUserId, adminRole)
  if (userResolution.errorResponse || !userResolution.targetUserId) {
    return userResolution.errorResponse!
  }

  if (requestedUserId) {
    const targetUser = await getUserById(auth, userResolution.targetUserId)
    if (!targetUser) {
      return c.json({ error: 'User not found' }, 404)
    }
  }

  const docs = await listApiKeys(auth, userResolution.targetUserId)
  return c.json({ docs })
}

async function handleCreateApiKey(
  c: Context<LontarEnv>,
  auth: Auth,
  adminRole: string,
): Promise<Response> {
  const authCheck = checkAuthAccess(c)
  if (authCheck.errorResponse || !authCheck.user) {
    return authCheck.errorResponse!
  }

  const parsed = await parseCreateBody(c)
  if (parsed.errorResponse || !parsed.data) {
    return parsed.errorResponse!
  }

  const userResolution = resolveTargetUserId(c, authCheck.user, parsed.data.userId, adminRole)
  if (userResolution.errorResponse || !userResolution.targetUserId) {
    return userResolution.errorResponse!
  }

  const targetUser = await getUserById(auth, userResolution.targetUserId)
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404)
  }

  const apiKey = await createApiKey(auth, {
    userId: userResolution.targetUserId,
    name: parsed.data.name,
    expiresIn: parsed.data.expiresIn,
  })

  return c.json({ apiKey }, 201)
}

async function handleDeleteApiKey(
  c: Context<LontarEnv>,
  auth: Auth,
  adminRole: string,
): Promise<Response> {
  const authCheck = checkAuthAccess(c)
  if (authCheck.errorResponse || !authCheck.user) {
    return authCheck.errorResponse!
  }

  const id = c.req.param('id')
  if (!id) {
    return c.json({ error: 'API key not found' }, 404)
  }
  const existing = await getApiKeyById(auth, id)
  if (!existing) {
    return c.json({ error: 'API key not found' }, 404)
  }

  const isOwner = existing.userId === authCheck.user.id
  const isAdmin = authCheck.user.role === adminRole

  if (!isOwner && !isAdmin) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await revokeApiKey(auth, id, authCheck.user, adminRole)
  return c.json({ success: true })
}

export function registerApiKeyRoutes(router: Hono<LontarEnv>, auth: Auth, config?: Config): void {
  const adminRole = config?.auth?.adminRole ?? 'admin'

  router.get('/_lontar/api-keys', (c) => handleListApiKeys(c, auth, adminRole))
  router.post('/_lontar/api-keys', (c) => handleCreateApiKey(c, auth, adminRole))
  router.delete('/_lontar/api-keys/:id', (c) => handleDeleteApiKey(c, auth, adminRole))
}
