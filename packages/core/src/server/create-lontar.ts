import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { adminAc, defaultAc } from 'better-auth/plugins/admin/access'
import { Hono, type Context } from 'hono'
import type { Auth, AuthSession, AuthUser, LontarVariables } from '../auth/types'
import { toClientConfig } from '../config/to-client-config'
import type { Config } from '../config/types'
import { resolveEmailConfig, sendEmailWithTemplate } from '../email'
import { registerCollectionRoutes } from './routes/collection'
import { registerFirstUserRoutes } from './routes/first-user'
import { registerGlobalRoutes } from './routes/global'
import { registerPermissionsRoutes } from './routes/permissions'
import { registerUserRoutes } from './routes/users'

export interface CreateLontarOptions {
  basePath?: string
  baseURL?: string
  adminPath?: string
  trustedOrigins?: string[]
  rateLimit?: {
    enabled?: boolean
    window?: number
    max?: number
  }
}

export type LontarApp = Hono<{ Variables: LontarVariables }> & {
  readonly auth: Auth
}

function buildTrustedOrigins(options: CreateLontarOptions): string[] {
  const defaultOrigins =
    process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000']
  const envOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return Array.from(new Set([...defaultOrigins, ...envOrigins, ...(options.trustedOrigins ?? [])]))
}

function resolveRateLimitEnabled(options: CreateLontarOptions): boolean {
  if (options.rateLimit?.enabled !== undefined) return options.rateLimit.enabled
  return (
    process.env.NODE_ENV !== 'test' &&
    process.env.PLAYWRIGHT !== 'true' &&
    process.env.DISABLE_AUTH_RATE_LIMIT !== 'true'
  )
}

function buildAdminPlugin(authConfig?: Config['auth']) {
  const roles = authConfig?.roles ?? ['admin', 'editor']
  const defaultRole = authConfig?.defaultRole ?? 'editor'
  const adminRole = authConfig?.adminRole ?? 'admin'

  const customRoles = Object.fromEntries(
    roles.map((r) => [r, r === adminRole ? adminAc : defaultAc.newRole({ user: [], session: [] })]),
  )

  return admin({
    defaultRole,
    adminRoles: [adminRole],
    roles: customRoles,
  })
}

function buildRateLimitConfig(options: CreateLontarOptions) {
  return {
    enabled: resolveRateLimitEnabled(options),
    ...(options.rateLimit?.window !== undefined ? { window: options.rateLimit.window } : {}),
    ...(options.rateLimit?.max !== undefined ? { max: options.rateLimit.max } : {}),
  }
}

function resolveAdminBaseUrl(options: CreateLontarOptions, request?: Request): string {
  const origin =
    options.baseURL ?? (request ? new URL(request.url).origin : 'http://localhost:3000')
  const adminPath = (options.adminPath ?? '/admin').replace(/\/$/, '')
  return `${origin}${adminPath}`
}

function buildAuthInstance(config: Config, basePath: string, options: CreateLontarOptions): Auth {
  const trustedOrigins = buildTrustedOrigins(options)
  const resolvedEmail = resolveEmailConfig(config.email)

  return betterAuth({
    secret: config.secret,
    basePath: `${basePath}/auth`,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),
    ...(config.db.authAdapter ? { database: config.db.authAdapter } : {}),
    plugins: [buildAdminPlugin(config.auth)],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      ...(resolvedEmail
        ? {
            sendResetPassword: async (
              data: { user: { id: string; email: string; name?: string }; token: string },
              request?: unknown,
            ) => {
              const req = request instanceof Request ? request : undefined
              const adminUrl = resolveAdminBaseUrl(options, req)
              const resetUrl = `${adminUrl}/reset-password?token=${data.token}`
              await sendEmailWithTemplate(resolvedEmail, 'resetPassword', {
                user: { id: data.user.id, email: data.user.email, name: data.user.name },
                url: resetUrl,
                token: data.token,
              })
            },
            ...(config.auth?.requireEmailVerification
              ? {
                  requireEmailVerification: true,
                  sendVerificationEmail: async (
                    data: { user: { id: string; email: string; name?: string }; token: string },
                    request?: unknown,
                  ) => {
                    const req = request instanceof Request ? request : undefined
                    const adminUrl = resolveAdminBaseUrl(options, req)
                    const verifyUrl = `${adminUrl}/verify-email?token=${data.token}`
                    await sendEmailWithTemplate(resolvedEmail, 'verifyEmail', {
                      user: { id: data.user.id, email: data.user.email, name: data.user.name },
                      url: verifyUrl,
                      token: data.token,
                    })
                  },
                }
              : {}),
          }
        : {}),
    },
    rateLimit: buildRateLimitConfig(options),
  })
}

export function createLontar(config: Config, options: CreateLontarOptions = {}): LontarApp {
  const app = new Hono<{ Variables: LontarVariables }>()
  const basePath = options.basePath ?? '/api'
  const router = new Hono<{ Variables: LontarVariables }>()

  const defaultErrorHandler = (
    err: Error,
    c: Context<{ Variables: LontarVariables }>,
  ): Response => {
    console.error(err)
    return c.json({ error: 'Internal Server Error' }, 500)
  }

  app.onError(defaultErrorHandler)
  router.onError(defaultErrorHandler)

  const auth = buildAuthInstance(config, basePath, options)

  // Mount Better Auth handler routes at /auth/*
  router.post('/auth/forget-password', async (c) => {
    const url = new URL(c.req.url)
    url.pathname = url.pathname.replace(/\/auth\/forget-password$/, '/auth/request-password-reset')
    const req = new Request(url.toString(), c.req.raw)
    return auth.handler(req)
  })
  router.all('/auth/*', (c) => auth.handler(c.req.raw))

  // Session verification middleware for all subsequent routes
  router.use('*', async (c, next) => {
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      const user = session?.user as AuthUser | undefined
      const isBanned =
        user?.banned && (!user.banExpires || new Date(user.banExpires).getTime() > Date.now())
      if (isBanned) {
        c.set('user', null)
        c.set('session', null)
      } else {
        c.set('user', user ?? null)
        c.set('session', (session?.session as AuthSession) ?? null)
      }
    } catch {
      c.set('user', null)
      c.set('session', null)
    }
    await next()
  })

  // ClientConfig endpoint
  router.get('/_lontar/config', (c) => {
    return c.json(toClientConfig(config))
  })

  // Current session endpoint
  router.get('/_lontar/me', (c) => {
    return c.json({
      user: c.get('user'),
      session: c.get('session'),
    })
  })

  // Permissions endpoint
  registerPermissionsRoutes(router, config)

  // First-user onboarding routes
  registerFirstUserRoutes(router, auth, config)

  // User management routes
  registerUserRoutes(router, auth, config, options)

  // Global routes
  registerGlobalRoutes(router, config)

  // Collection CRUD routes
  registerCollectionRoutes(router, config)

  app.route(basePath, router)
  ;(app as unknown as { auth: unknown }).auth = auth
  return app as LontarApp
}
