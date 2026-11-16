import type { Auth } from './types'

export interface CreateUserData {
  email: string
  password: string
  name: string
  role?: string
}

export interface CreatedUserResult {
  id: string
  email: string
  name: string
  role: string
}

export async function createUserWithCredential(
  auth: Auth,
  data: CreateUserData,
): Promise<CreatedUserResult> {
  const ctx = await auth.$context
  const hashedPassword = await ctx.password.hash(data.password)

  const user = await ctx.internalAdapter.createUser(
    {
      email: data.email,
      name: data.name,
      ...(data.role ? { role: data.role } : {}),
      banned: false,
      emailVerified: false,
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

export async function countTotalUsers(auth: Auth): Promise<number> {
  const ctx = await auth.$context
  return ctx.internalAdapter.countTotalUsers()
}
