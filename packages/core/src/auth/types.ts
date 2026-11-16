import type { betterAuth } from 'better-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Auth = ReturnType<typeof betterAuth<any>>
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['session']

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- meant to be augmented by consumers via declaration merging
export interface UserRoleExtension {}
export type UserRoleType = UserRoleExtension extends { role: infer R }
  ? R extends string
    ? R
    : string
  : string

export type AuthUser = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['user'] & {
  role: UserRoleType
  banned?: boolean
  banReason?: string | null
  banExpires?: Date | null
  [key: string]: unknown
}

export interface LontarVariables {
  user: AuthUser | null
  session: AuthSession | null
  permissions?: unknown
}
