import type { Context, Hono } from 'hono'
import { createApiKey, getApiKeyById, listApiKeys, revokeApiKey } from '../../auth/api-key'
import type { Auth, AuthUser, LontarVariables } from '../../auth/types'
import type { Config } from '../../config/types'

type LontarEnv = { Variables: LontarVariables }

interface CreateApiKeyBody {
  name?: string
  expiresIn?: number | null
  userId?: string
}

function checkAuthAccess(c: Context<LontarEnv>): {
  user?: AuthUser
  errorResponse?: Response
} {
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
): Promise<{ body?: CreateApiKeyBody; errorResponse?: Response }> {
  try {
    const raw = await c.req.json<CreateApiKeyBody>()
    return { body: raw }
  } catch {
    return { errorResponse: c.json({ error: 'Invalid JSON body' }, 400) }
  }
}

function parseExpiresIn(val: unknown): number | null {
  return typeof val === 'number' && val > 0 ? val : null
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
  if (parsed.errorResponse || !parsed.body) {
    return parsed.errorResponse!
  }

  const name = parsed.body.name?.trim()
  if (!name) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const userResolution = resolveTargetUserId(c, authCheck.user, parsed.body.userId, adminRole)
  if (userResolution.errorResponse || !userResolution.targetUserId) {
    return userResolution.errorResponse!
  }

  const apiKey = await createApiKey(auth, {
    userId: userResolution.targetUserId,
    name,
    expiresIn: parseExpiresIn(parsed.body.expiresIn),
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
