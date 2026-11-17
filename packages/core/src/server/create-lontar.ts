import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { adminAc, defaultAc } from 'better-auth/plugins/admin/access'
import { Hono, type Context } from 'hono'
import { apiKeyPlugin, verifyApiKey, type ApiKeyItem } from '../auth/api-key'
import {
  RateLimiter,
  getClientIp,
  resolveRateLimitEnabled,
  type DatabaseAdapterLike,
  type RateLimitOptions,
} from '../auth/rate-limit'
import type { Auth, AuthSession, AuthUser, LontarVariables } from '../auth/types'
import { toClientConfig } from '../config/to-client-config'
import type { Config } from '../config/types'
import { resolveEmailConfig, sendEmailWithTemplate } from '../email'
import { registerApiKeyRoutes } from './routes/api-keys'
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
  rateLimit?: RateLimitOptions
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

const DEFAULT_BETTER_AUTH_CUSTOM_RULES: Record<string, { window: number; max: number }> = {
  '/sign-in/*': { window: 60, max: 5 },
  '/request-password-reset': { window: 60, max: 3 },
  '/reset-password': { window: 60, max: 5 },
  '/forget-password': { window: 60, max: 3 },
}

function buildRateLimitConfig(options: CreateLontarOptions) {
  const customRules = {
    ...DEFAULT_BETTER_AUTH_CUSTOM_RULES,
    ...options.rateLimit?.customRules,
  }

  return {
    enabled: resolveRateLimitEnabled(options),
    ...(options.rateLimit?.storage ? { storage: options.rateLimit.storage } : {}),
    ...(options.rateLimit?.customStorage ? { customStorage: options.rateLimit.customStorage } : {}),
    ...(options.rateLimit?.window !== undefined ? { window: options.rateLimit.window } : {}),
    ...(options.rateLimit?.max !== undefined ? { max: options.rateLimit.max } : {}),
    customRules,
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
    plugins: [buildAdminPlugin(config.auth), apiKeyPlugin()],
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

function extractApiKeyToken(apiKeyHeader?: string, authHeader?: string): string | null {
  if (apiKeyHeader) {
    return apiKeyHeader.trim()
  }
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token.startsWith('lt_')) {
      return token
    }
  }
  return null
}

async function resolveSessionUser(
  auth: Auth,
  headers: Headers,
): Promise<{ user: AuthUser | null; session: AuthSession | null }> {
  try {
    const session = await auth.api.getSession({ headers })
    const user = session?.user as AuthUser | undefined
    const isBanned =
      user?.banned && (!user.banExpires || new Date(user.banExpires).getTime() > Date.now())
    if (isBanned) {
      return { user: null, session: null }
    }
    return {
      user: user ?? null,
      session: (session?.session as AuthSession) ?? null,
    }
  } catch {
    return { user: null, session: null }
  }
}

type ApiKeyAuthResult =
  | { ok: true; user: AuthUser; apiKey: ApiKeyItem | null }
  | { ok: false; status: 401 | 429; error: string; retryAfter?: number }

async function authenticateApiKey(
  rawReq: Request,
  auth: Auth,
  apiKeyToken: string,
  rateLimiter: RateLimiter,
): Promise<ApiKeyAuthResult> {
  const ip = getClientIp(rawReq)
  const blockedCheck = await rateLimiter.checkApiKeyFailureLimit(ip)
  if (!blockedCheck.allowed) {
    const retryAfter = blockedCheck.retryAfter ?? rateLimiter.rules.apiKeyFailure.window
    return {
      ok: false,
      status: 429,
      error: 'Too many failed API key attempts. Please try again later.',
      retryAfter,
    }
  }

  const result = await verifyApiKey(auth, apiKeyToken)
  if (!result.valid || !result.user) {
    const failureRecord = await rateLimiter.recordApiKeyFailure(ip)
    if (!failureRecord.allowed) {
      const retryAfter = failureRecord.retryAfter ?? rateLimiter.rules.apiKeyFailure.window
      return {
        ok: false,
        status: 429,
        error: 'Too many failed API key attempts. Please try again later.',
        retryAfter,
      }
    }
    return { ok: false, status: 401, error: result.error ?? 'Invalid API key' }
  }

  return { ok: true, user: result.user, apiKey: result.apiKey ?? null }
}

function wrapAuthResponse(res: Response): Response {
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after') ?? res.headers.get('x-retry-after')
    if (retryAfter && !res.headers.get('retry-after')) {
      const headers = new Headers(res.headers)
      headers.set('Retry-After', retryAfter)
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      })
    }
  }
  return res
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

  const rateLimiter = new RateLimiter(options.rateLimit ?? {}, async () => {
    const ctx = await auth.$context
    return ctx.adapter as unknown as DatabaseAdapterLike
  })

  // Mount Better Auth handler routes at /auth/*
  router.post('/auth/forget-password', async (c) => {
    const url = new URL(c.req.url)
    url.pathname = url.pathname.replace(/\/auth\/forget-password$/, '/auth/request-password-reset')
    const req = new Request(url.toString(), c.req.raw)
    return wrapAuthResponse(await auth.handler(req))
  })
  router.all('/auth/*', async (c) => wrapAuthResponse(await auth.handler(c.req.raw)))

  // Session & API key verification middleware for all subsequent routes
  router.use('*', async (c, next) => {
    const apiKeyToken = extractApiKeyToken(c.req.header('x-api-key'), c.req.header('authorization'))

    if (apiKeyToken) {
      const authResult = await authenticateApiKey(c.req.raw, auth, apiKeyToken, rateLimiter)
      if (!authResult.ok) {
        if (authResult.status === 429) {
          return c.json({ error: authResult.error }, 429, {
            'Retry-After': String(authResult.retryAfter),
            'X-Retry-After': String(authResult.retryAfter),
          })
        }
        return c.json({ error: authResult.error }, 401)
      }
      c.set('user', authResult.user)
      c.set('session', null)
      c.set('apiKey', authResult.apiKey)
      return await next()
    }

    const { user, session } = await resolveSessionUser(auth, c.req.raw.headers)
    c.set('user', user)
    c.set('session', session)
    return await next()
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
  registerFirstUserRoutes(router, auth, config, rateLimiter)

  // User management routes
  registerUserRoutes(router, auth, config, options, rateLimiter)

  // API key routes
  registerApiKeyRoutes(router, auth, config)

  // Global routes
  registerGlobalRoutes(router, config)

  // Collection CRUD routes
  registerCollectionRoutes(router, config)

  app.route(basePath, router)
  ;(app as unknown as { auth: unknown }).auth = auth
  return app as LontarApp
}
