import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import type { Auth, AuthUser, LontarVariables } from '../../auth/types'
import {
  countActiveAdmins,
  countTotalAdmins,
  createUserForInvite,
  createUserWithCredential,
  deleteUser,
  disableUser,
  enableUser,
  getUserByEmail,
  getUserById,
  listUsers,
  revokeUserSessions,
  setUserPassword,
  updateUser,
  verifyAndChangePassword,
} from '../../auth/user'
import type { Config } from '../../config/types'
import { resolveEmailConfig, sendEmailWithTemplate } from '../../email'
import type { CreateLontarOptions } from '../create-lontar'

type LontarEnv = { Variables: LontarVariables }

interface CreateUserBody {
  email?: string
  password?: string
  name?: string
  role?: string
  invite?: boolean
}

interface CreateUserValidatedData {
  name: string
  email: string
  role: string
  password?: string
  invite?: boolean
}

interface UpdateUserBody {
  name?: string
  role?: string
}

interface PasswordBody {
  password?: string
}

interface ChangePasswordBody {
  currentPassword?: string
  newPassword?: string
}

function checkAdminAccess(
  c: Context<LontarEnv>,
  config?: Config,
): { user?: AuthUser; errorResponse?: Response } {
  const user = c.get('user')
  if (!user) {
    return { errorResponse: c.json({ error: 'Unauthorized' }, 401) }
  }
  const adminRole = config?.auth?.adminRole ?? 'admin'
  if (user.role !== adminRole) {
    return { errorResponse: c.json({ error: 'Forbidden' }, 403) }
  }
  return { user }
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

async function parseJsonBody(c: Context<LontarEnv>): Promise<{ body?: unknown; error?: Response }> {
  try {
    const json = await c.req.json<unknown>()
    return { body: json }
  } catch {
    return { error: c.json({ error: 'Invalid JSON request body' }, 400) }
  }
}

function validateEmail(email?: unknown): string | null {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return 'A valid email is required'
  }
  return null
}

function validatePasswordLength(password?: unknown): string | null {
  if (!password || typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long'
  }
  return null
}

function validateName(name?: unknown): string | null {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return 'Name is required'
  }
  return null
}

function validatePasswordOrInvite(
  invite?: boolean,
  password?: string,
  config?: Config,
): string | null {
  if (invite) {
    if (!config?.email) {
      return 'Cannot invite user: email service is not configured'
    }
    return null
  }
  return validatePasswordLength(password)
}

function resolveRole(role?: string, config?: Config): { role?: string; error?: string } {
  const allowedRoles = config?.auth?.roles ?? ['admin', 'editor']
  const defaultRole = config?.auth?.defaultRole ?? 'editor'
  const chosenRole = role ?? defaultRole

  if (!allowedRoles.includes(chosenRole)) {
    return { error: `Invalid role "${chosenRole}". Permitted roles: ${allowedRoles.join(', ')}` }
  }
  return { role: chosenRole }
}

function validateCreateUserInput(
  body: unknown,
  config?: Config,
): { error?: string; data?: CreateUserValidatedData } {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid JSON request body' }
  }
  const { email, password, name, role, invite } = body as CreateUserBody

  const nameError = validateName(name)
  if (nameError) return { error: nameError }

  const emailError = validateEmail(email)
  if (emailError) return { error: emailError }

  const authModeError = validatePasswordOrInvite(invite, password, config)
  if (authModeError) return { error: authModeError }

  const roleResult = resolveRole(role, config)
  if (roleResult.error || !roleResult.role) return { error: roleResult.error }

  return {
    data: {
      name: (name as string).trim(),
      email: (email as string).trim().toLowerCase(),
      password,
      role: roleResult.role,
      invite: Boolean(invite),
    },
  }
}

function validateRoleChange(
  role: string,
  targetId: string,
  currentUser: AuthUser,
  config?: Config,
): string | null {
  const allowedRoles = config?.auth?.roles ?? ['admin', 'editor']
  const adminRole = config?.auth?.adminRole ?? 'admin'

  if (!allowedRoles.includes(role)) {
    return `Invalid role "${role}". Permitted roles: ${allowedRoles.join(', ')}`
  }
  if (targetId === currentUser.id && role !== adminRole) {
    return 'You cannot change your own role'
  }
  return null
}

async function checkActiveAdminGuard(
  auth: Auth,
  targetRole: string,
  adminRole: string,
  actionMsg: string,
): Promise<string | null> {
  if (targetRole !== adminRole) return null
  const activeAdmins = await countActiveAdmins(auth, adminRole)
  if (activeAdmins <= 1) {
    return `Cannot ${actionMsg} the last administrator`
  }
  return null
}

async function handleListUsers(
  c: Context<LontarEnv>,
  auth: Auth,
  config?: Config,
): Promise<Response> {
  const { errorResponse } = checkAdminAccess(c, config)
  if (errorResponse) return errorResponse

  const page = Number(c.req.query('page') ?? '1')
  const limit = Number(c.req.query('limit') ?? '10')
  const search = c.req.query('search')
  const role = c.req.query('role')

  const result = await listUsers(auth, {
    page: Number.isNaN(page) ? 1 : page,
    limit: Number.isNaN(limit) ? 10 : limit,
    search: search || undefined,
    role: role || undefined,
  })

  return c.json(result)
}

function resolveAdminBaseUrl(c: Context<LontarEnv>, options?: CreateLontarOptions): string {
  const origin = options?.baseURL ?? new URL(c.req.url).origin
  const adminPath = (options?.adminPath ?? '/admin').replace(/\/$/, '')
  return `${origin}${adminPath}`
}

async function handleInviteUser(
  c: Context<LontarEnv>,
  auth: Auth,
  data: CreateUserValidatedData,
  config?: Config,
  options?: CreateLontarOptions,
): Promise<Response> {
  const resolvedEmail = resolveEmailConfig(config?.email)
  if (!resolvedEmail) {
    return c.json({ error: 'Cannot invite user: email service is not configured' }, 400)
  }

  const created = await createUserForInvite(auth, {
    name: data.name,
    email: data.email,
    role: data.role,
  })

  const token = randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const ctx = await auth.$context

  await ctx.internalAdapter.createVerificationValue({
    value: created.id,
    identifier: `reset-password:${token}`,
    expiresAt,
  })

  const adminBase = resolveAdminBaseUrl(c, options)
  const inviteUrl = `${adminBase}/accept-invite?token=${token}`

  try {
    await sendEmailWithTemplate(resolvedEmail, 'invite', {
      user: { id: created.id, email: created.email, name: created.name },
      url: inviteUrl,
      token,
    })
  } catch (err) {
    await ctx.internalAdapter.deleteUser(created.id)
    await ctx.internalAdapter.deleteVerificationByIdentifier(`reset-password:${token}`)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: `Failed to send invitation email: ${msg}` }, 500)
  }

  const user = await getUserById(auth, created.id)
  return c.json({ user, invited: true }, 201)
}

async function handleResendInvite(
  c: Context<LontarEnv>,
  auth: Auth,
  id: string,
  config?: Config,
  options?: CreateLontarOptions,
): Promise<Response> {
  const { errorResponse } = checkAdminAccess(c, config)
  if (errorResponse) return errorResponse

  const resolvedEmail = resolveEmailConfig(config?.email)
  if (!resolvedEmail) {
    return c.json({ error: 'Cannot invite user: email service is not configured' }, 400)
  }

  const user = await getUserById(auth, id)
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  const token = randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const ctx = await auth.$context

  await ctx.internalAdapter.createVerificationValue({
    value: user.id,
    identifier: `reset-password:${token}`,
    expiresAt,
  })

  const adminBase = resolveAdminBaseUrl(c, options)
  const inviteUrl = `${adminBase}/accept-invite?token=${token}`

  try {
    await sendEmailWithTemplate(resolvedEmail, 'invite', {
      user: { id: user.id, email: user.email, name: user.name },
      url: inviteUrl,
      token,
    })
  } catch (err) {
    await ctx.internalAdapter.deleteVerificationByIdentifier(`reset-password:${token}`)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: `Failed to send invitation email: ${msg}` }, 500)
  }

  return c.json({ success: true, message: `Invitation sent to ${user.email}` })
}

async function handleCreateUser(
  c: Context<LontarEnv>,
  auth: Auth,
  config?: Config,
  options?: CreateLontarOptions,
): Promise<Response> {
  const { errorResponse } = checkAdminAccess(c, config)
  if (errorResponse) return errorResponse

  const { body, error } = await parseJsonBody(c)
  if (error) return error

  const validated = validateCreateUserInput(body, config)
  if (!validated.data) {
    return c.json({ error: validated.error }, 400)
  }

  const existing = await getUserByEmail(auth, validated.data.email)
  if (existing) {
    return c.json({ error: 'User with this email already exists' }, 400)
  }

  if (validated.data.invite) {
    return await handleInviteUser(c, auth, validated.data, config, options)
  }

  const created = await createUserWithCredential(auth, {
    name: validated.data.name,
    email: validated.data.email,
    password: validated.data.password!,
    role: validated.data.role,
  })
  const user = await getUserById(auth, created.id)
  return c.json({ user }, 201)
}

async function handleGetUser(
  c: Context<LontarEnv>,
  auth: Auth,
  id: string,
  config?: Config,
): Promise<Response> {
  const { errorResponse } = checkAdminAccess(c, config)
  if (errorResponse) return errorResponse

  const user = await getUserById(auth, id)
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  return c.json({ user })
}

function validateUpdateName(name?: unknown): string | null {
  if (name === undefined) return null
  if (!name || typeof name !== 'string' || !name.trim()) {
    return 'Name cannot be empty'
  }
  return null
}

async function validateUpdateRole(
  auth: Auth,
  role: string | undefined,
  targetUserId: string,
  targetUserRole: string,
  currentUser: AuthUser,
  config?: Config,
): Promise<string | null> {
  if (role === undefined) return null
  const adminRole = config?.auth?.adminRole ?? 'admin'
  const roleError = validateRoleChange(role, targetUserId, currentUser, config)
  if (roleError) return roleError
  if (role !== adminRole) {
    return await checkActiveAdminGuard(auth, targetUserRole, adminRole, 'demote')
  }
  return null
}

async function handleUpdateUser(
  c: Context<LontarEnv>,
  auth: Auth,
  id: string,
  config?: Config,
): Promise<Response> {
  const { user: currentUser, errorResponse } = checkAdminAccess(c, config)
  if (errorResponse || !currentUser) return errorResponse!

  const targetUser = await getUserById(auth, id)
  if (!targetUser) return c.json({ error: 'User not found' }, 404)

  const { body, error } = await parseJsonBody(c)
  if (error) return error

  const updateBody = (body ?? {}) as UpdateUserBody
  const nameError = validateUpdateName(updateBody.name)
  if (nameError) return c.json({ error: nameError }, 400)

  const roleError = await validateUpdateRole(
    auth,
    updateBody.role,
    id,
    targetUser.role,
    currentUser,
    config,
  )
  if (roleError) return c.json({ error: roleError }, 400)

  const updated = await updateUser(auth, id, { name: updateBody.name, role: updateBody.role })
  return c.json({ user: updated })
}

async function parseDisableReason(c: Context<LontarEnv>): Promise<string | undefined> {
  try {
    const body = await c.req.json<{ reason?: unknown }>()
    if (body && typeof body.reason === 'string') {
      return body.reason
    }
  } catch {
    // optional body
  }
  return undefined
}

async function handleDisableUser(
  c: Context<LontarEnv>,
  auth: Auth,
  id: string,
  config?: Config,
): Promise<Response> {
  const { user: currentUser, errorResponse } = checkAdminAccess(c, config)
  if (errorResponse || !currentUser) return errorResponse!

  if (id === currentUser.id) {
    return c.json({ error: 'You cannot disable your own account' }, 400)
  }

  const targetUser = await getUserById(auth, id)
  if (!targetUser) return c.json({ error: 'User not found' }, 404)

  const adminRole = config?.auth?.adminRole ?? 'admin'
  const guardError = await checkActiveAdminGuard(auth, targetUser.role, adminRole, 'disable')
  if (guardError) return c.json({ error: guardError }, 400)

  const reason = await parseDisableReason(c)
  const disabled = await disableUser(auth, id, reason)
  return c.json({ message: 'User disabled successfully', user: disabled })
}

async function handleEnableUser(
  c: Context<LontarEnv>,
  auth: Auth,
  id: string,
  config?: Config,
): Promise<Response> {
  const { errorResponse } = checkAdminAccess(c, config)
  if (errorResponse) return errorResponse

  const targetUser = await getUserById(auth, id)
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404)
  }

  const enabled = await enableUser(auth, id)
  return c.json({ message: 'User enabled successfully', user: enabled })
}

async function handleRevokeSessions(
  c: Context<LontarEnv>,
  auth: Auth,
  id: string,
  config?: Config,
): Promise<Response> {
  const { errorResponse } = checkAdminAccess(c, config)
  if (errorResponse) return errorResponse

  const targetUser = await getUserById(auth, id)
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404)
  }

  await revokeUserSessions(auth, id)
  return c.json({ message: 'Sessions revoked successfully' })
}

async function handleAdminSetPassword(
  c: Context<LontarEnv>,
  auth: Auth,
  id: string,
  config?: Config,
): Promise<Response> {
  const { errorResponse } = checkAdminAccess(c, config)
  if (errorResponse) return errorResponse

  const targetUser = await getUserById(auth, id)
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404)
  }

  const { body, error } = await parseJsonBody(c)
  if (error) return error

  const { password } = (body ?? {}) as PasswordBody
  if (!password || typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters long' }, 400)
  }

  await setUserPassword(auth, id, password)
  return c.json({ message: 'Password updated successfully' })
}

async function handleDeleteUser(
  c: Context<LontarEnv>,
  auth: Auth,
  id: string,
  config?: Config,
): Promise<Response> {
  const { user: currentUser, errorResponse } = checkAdminAccess(c, config)
  if (errorResponse || !currentUser) return errorResponse!

  if (id === currentUser.id) {
    return c.json({ error: 'You cannot delete your own account' }, 400)
  }

  const targetUser = await getUserById(auth, id)
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404)
  }

  const adminRole = config?.auth?.adminRole ?? 'admin'
  if (targetUser.role === adminRole) {
    const totalAdmins = await countTotalAdmins(auth, adminRole)
    if (totalAdmins <= 1) {
      return c.json({ error: 'Cannot delete the last administrator' }, 400)
    }
  }

  await deleteUser(auth, id)
  return c.json({ message: 'User deleted successfully' })
}

async function handleUpdateMe(c: Context<LontarEnv>, auth: Auth): Promise<Response> {
  const { user, errorResponse } = checkAuthAccess(c)
  if (errorResponse || !user) return errorResponse!

  const { body, error } = await parseJsonBody(c)
  if (error) return error

  const { name } = (body ?? {}) as { name?: string }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const updated = await updateUser(auth, user.id, { name: name.trim() })
  return c.json({ user: updated })
}

function validateChangePasswordBody(body: unknown): {
  error?: string
  data?: { currentPassword: string; newPassword: string }
} {
  const { currentPassword, newPassword } = (body ?? {}) as ChangePasswordBody
  if (!currentPassword || typeof currentPassword !== 'string') {
    return { error: 'Current password is required' }
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return { error: 'New password must be at least 8 characters long' }
  }
  return { data: { currentPassword, newPassword } }
}

async function handleChangeMePassword(c: Context<LontarEnv>, auth: Auth): Promise<Response> {
  const { user, errorResponse } = checkAuthAccess(c)
  if (errorResponse || !user) return errorResponse!

  const { body, error } = await parseJsonBody(c)
  if (error) return error

  const validated = validateChangePasswordBody(body)
  if (validated.error || !validated.data) {
    return c.json({ error: validated.error }, 400)
  }

  try {
    await verifyAndChangePassword(
      auth,
      user.id,
      validated.data.currentPassword,
      validated.data.newPassword,
    )
    return c.json({ message: 'Password changed successfully' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to change password'
    return c.json({ error: message }, 400)
  }
}

export function registerUserRoutes(
  router: Hono<LontarEnv>,
  auth: Auth,
  config?: Config,
  options?: CreateLontarOptions,
): void {
  // Self-service profile and password
  router.patch('/_lontar/me', (c) => handleUpdateMe(c, auth))
  router.post('/_lontar/me/password', (c) => handleChangeMePassword(c, auth))

  // User management endpoints
  router.get('/_lontar/users', (c) => handleListUsers(c, auth, config))
  router.post('/_lontar/users', (c) => handleCreateUser(c, auth, config, options))
  router.post('/_lontar/users/:id/resend-invite', (c) =>
    handleResendInvite(c, auth, c.req.param('id') ?? '', config, options),
  )
  router.get('/_lontar/users/:id', (c) => handleGetUser(c, auth, c.req.param('id') ?? '', config))
  router.patch('/_lontar/users/:id', (c) =>
    handleUpdateUser(c, auth, c.req.param('id') ?? '', config),
  )
  router.post('/_lontar/users/:id/disable', (c) =>
    handleDisableUser(c, auth, c.req.param('id') ?? '', config),
  )
  router.post('/_lontar/users/:id/enable', (c) =>
    handleEnableUser(c, auth, c.req.param('id') ?? '', config),
  )
  router.post('/_lontar/users/:id/revoke-sessions', (c) =>
    handleRevokeSessions(c, auth, c.req.param('id') ?? '', config),
  )
  router.post('/_lontar/users/:id/password', (c) =>
    handleAdminSetPassword(c, auth, c.req.param('id') ?? '', config),
  )
  router.delete('/_lontar/users/:id', (c) =>
    handleDeleteUser(c, auth, c.req.param('id') ?? '', config),
  )
}
