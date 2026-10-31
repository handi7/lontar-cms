import type { betterAuth } from 'better-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Auth = ReturnType<typeof betterAuth<any>>
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['session']
export type AuthUser = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['user']

export interface LontarVariables {
  user: AuthUser | null
  session: AuthSession | null
}
