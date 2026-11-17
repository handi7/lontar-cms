import type { Where } from 'better-auth/types'
import type { Auth } from './types'

export interface CreateUserData {
  email: string
  password: string
  name: string
  role?: string
  emailVerified?: boolean
}

export interface CreateUserInviteData {
  email: string
  name: string
  role?: string
}

export interface CreatedUserResult {
  id: string
  email: string
  name: string
  role: string
}

export interface CleanUser {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  banReason: string | null
  banExpires: Date | null
  image: string | null
  emailVerified: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ListUsersOptions {
  page?: number
  limit?: number
  search?: string
  role?: string
}

export interface PaginatedUsers {
  docs: CleanUser[]
  totalDocs: number
  limit: number
  totalPages: number
  page: number
  pagingCounter: number
  hasPrevPage: boolean
  hasNextPage: boolean
  prevPage: number | null
  nextPage: number | null
}

function parseStringProp(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback
}

function parseNullableString(val: unknown): string | null {
  return typeof val === 'string' ? val : null
}

function parseNullableDate(val: unknown): Date | null {
  if (!val) return null
  return val instanceof Date ? val : new Date(val as string | number)
}

function parseDateProp(val: unknown): Date {
  if (val instanceof Date) return val
  if (typeof val === 'string' || typeof val === 'number') return new Date(val)
  return new Date()
}

export function cleanUser(raw: unknown): CleanUser {
  const u = (raw ?? {}) as Record<string, unknown>
  return {
    id: parseStringProp(u.id),
    name: parseStringProp(u.name),
    email: parseStringProp(u.email),
    role: parseStringProp(u.role, 'editor'),
    banned: Boolean(u.banned),
    banReason: parseNullableString(u.banReason),
    banExpires: parseNullableDate(u.banExpires),
    image: parseNullableString(u.image),
    emailVerified: Boolean(u.emailVerified),
    createdAt: parseDateProp(u.createdAt),
    updatedAt: parseDateProp(u.updatedAt),
  }
}

export async function createUserWithCredential(
  auth: Auth,
  data: CreateUserData,
): Promise<CreatedUserResult> {
  const ctx = await auth.$context
  const hashedPassword = await ctx.password.hash(data.password)

  const user = await ctx.internalAdapter.createUser(
    {
      email: data.email.trim().toLowerCase(),
      name: data.name.trim(),
      ...(data.role ? { role: data.role } : {}),
      banned: false,
      emailVerified: data.emailVerified ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { method: 'email-password' },
  )

  await ctx.internalAdapter.createAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hashedPassword,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: (user as { role?: string }).role ?? data.role ?? 'editor',
  }
}

export async function createUserForInvite(
  auth: Auth,
  data: CreateUserInviteData,
): Promise<CreatedUserResult> {
  const ctx = await auth.$context

  const user = await ctx.internalAdapter.createUser(
    {
      email: data.email.trim().toLowerCase(),
      name: data.name.trim(),
      ...(data.role ? { role: data.role } : {}),
      banned: false,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { method: 'email-password' },
  )

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: (user as { role?: string }).role ?? data.role ?? 'editor',
  }
}

export async function hasCredentialAccount(auth: Auth, userId: string): Promise<boolean> {
  const ctx = await auth.$context
  const acc = await ctx.internalAdapter.findCredentialAccount(userId)
  return Boolean(acc)
}

export async function countTotalUsers(auth: Auth, where?: Where[]): Promise<number> {
  const ctx = await auth.$context
  return ctx.internalAdapter.countTotalUsers(where)
}

export async function getUserById(auth: Auth, id: string): Promise<CleanUser | null> {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.findUserById(id)
  return user ? cleanUser(user) : null
}

export async function getUserByEmail(auth: Auth, email: string): Promise<CleanUser | null> {
  const ctx = await auth.$context
  const record = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase())
  if (!record) return null
  const userObj = (record as { user?: unknown }).user ?? record
  return cleanUser(userObj)
}

function buildUserWhere(options?: ListUsersOptions): Where[] | undefined {
  const where: Where[] = []
  if (options?.role) {
    where.push({
      field: 'role',
      value: options.role,
      operator: 'eq',
      connector: 'AND',
    })
  }
  if (options?.search) {
    const s = options.search.trim()
    if (s) {
      where.push(
        { field: 'name', value: s, operator: 'contains', connector: 'OR' },
        { field: 'email', value: s, operator: 'contains', connector: 'OR' },
      )
    }
  }
  return where.length > 0 ? where : undefined
}

function matchesSearch(u: Record<string, unknown>, search: string): boolean {
  const name = typeof u.name === 'string' ? u.name.toLowerCase() : ''
  const email = typeof u.email === 'string' ? u.email.toLowerCase() : ''
  return name.includes(search) || email.includes(search)
}

function filterUsersMemory(
  users: Array<Record<string, unknown>>,
  options?: ListUsersOptions,
): Array<Record<string, unknown>> {
  let result = users
  if (options?.role) {
    result = result.filter((u) => u.role === options.role)
  }
  if (options?.search) {
    const s = options.search.trim().toLowerCase()
    if (s) {
      result = result.filter((u) => matchesSearch(u, s))
    }
  }
  return result
}

export async function listUsers(
  auth: Auth,
  options: ListUsersOptions = {},
): Promise<PaginatedUsers> {
  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(100, Math.max(1, options.limit ?? 10))
  const offset = (page - 1) * limit
  const where = buildUserWhere(options)

  const ctx = await auth.$context
  const rawUsers = (await ctx.internalAdapter.listUsers(
    limit,
    offset,
    { field: 'createdAt', direction: 'desc' },
    where,
  )) as Array<Record<string, unknown>>

  const filtered = filterUsersMemory(rawUsers, options)
  const total = await ctx.internalAdapter.countTotalUsers(where)
  const totalDocs = Math.max(total, filtered.length)
  const totalPages = Math.max(1, Math.ceil(totalDocs / limit))

  return {
    docs: filtered.map(cleanUser),
    totalDocs,
    limit,
    totalPages,
    page,
    pagingCounter: totalDocs === 0 ? 1 : offset + 1,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: page < totalPages ? page + 1 : null,
  }
}

export async function updateUser(
  auth: Auth,
  id: string,
  data: { name?: string; role?: string },
): Promise<CleanUser> {
  const ctx = await auth.$context
  const updated = await ctx.internalAdapter.updateUser(id, {
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.role !== undefined ? { role: data.role } : {}),
    updatedAt: new Date(),
  })
  return cleanUser(updated)
}

export async function disableUser(auth: Auth, id: string, reason?: string): Promise<CleanUser> {
  const ctx = await auth.$context
  const updated = await ctx.internalAdapter.updateUser(id, {
    banned: true,
    banReason: reason?.trim() || null,
    banExpires: null,
    updatedAt: new Date(),
  })
  await ctx.internalAdapter.deleteUserSessions(id)
  return cleanUser(updated)
}

export async function enableUser(auth: Auth, id: string): Promise<CleanUser> {
  const ctx = await auth.$context
  const updated = await ctx.internalAdapter.updateUser(id, {
    banned: false,
    banReason: null,
    banExpires: null,
    updatedAt: new Date(),
  })
  return cleanUser(updated)
}

export async function revokeUserSessions(auth: Auth, id: string): Promise<void> {
  const ctx = await auth.$context
  await ctx.internalAdapter.deleteUserSessions(id)
}

export async function deleteUser(auth: Auth, id: string): Promise<void> {
  const ctx = await auth.$context
  await ctx.internalAdapter.deleteUser(id)
}

export async function setUserPassword(auth: Auth, id: string, password: string): Promise<void> {
  const ctx = await auth.$context
  const hashedPassword = await ctx.password.hash(password)
  const existing = await ctx.internalAdapter.findCredentialAccount(id)
  if (existing) {
    await ctx.internalAdapter.updatePassword(id, hashedPassword)
  } else {
    await ctx.internalAdapter.createAccount({
      userId: id,
      providerId: 'credential',
      accountId: id,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
  await ctx.internalAdapter.deleteUserSessions(id)
}

export async function verifyAndChangePassword(
  auth: Auth,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const ctx = await auth.$context
  const account = await ctx.internalAdapter.findCredentialAccount(userId)
  if (!account || !(account as { password?: string }).password) {
    throw new Error('No password credential configured for this user')
  }
  const isMatch = await ctx.password.verify({
    hash: (account as { password: string }).password,
    password: currentPassword,
  })
  if (!isMatch) {
    throw new Error('Current password is incorrect')
  }
  const hashedNew = await ctx.password.hash(newPassword)
  await ctx.internalAdapter.updatePassword(userId, hashedNew)
}

export async function countActiveAdmins(auth: Auth, adminRole: string): Promise<number> {
  const ctx = await auth.$context
  const users = (await ctx.internalAdapter.listUsers(undefined, undefined, undefined, [
    { field: 'role', value: adminRole, operator: 'eq' },
  ])) as Array<Record<string, unknown>>

  return users.filter((u) => {
    if (!u.banned) return true
    if (u.banExpires) {
      return new Date(u.banExpires as string | number | Date).getTime() <= Date.now()
    }
    return false
  }).length
}

export async function countTotalAdmins(auth: Auth, adminRole: string): Promise<number> {
  const ctx = await auth.$context
  const users = (await ctx.internalAdapter.listUsers(undefined, undefined, undefined, [
    { field: 'role', value: adminRole, operator: 'eq' },
  ])) as Array<Record<string, unknown>>
  return users.length
}
