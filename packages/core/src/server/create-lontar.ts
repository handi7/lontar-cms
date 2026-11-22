import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { defaultAc } from 'better-auth/plugins/admin/access'
import { Hono, type Context } from 'hono'
import { createFieldAccessCache, requestFieldAccessCache } from '../access/field-access'
import { apiKeyPlugin, verifyApiKey, type ApiKeyItem } from '../auth/api-key'
import { LockTimeoutError } from '../auth/lock'
import { deleteUserResetTokens } from '../auth/user'
import { resolveAdminBaseUrl } from './admin-url'
import {
  RateLimiter,
  resolveIpResolutionOptions,
  resolveRateLimitEnabled,
  type DatabaseAdapterLike,
  type RateLimitOptions,
} from '../auth/rate-limit'
import type { Auth, AuthSession, AuthUser, LontarVariables } from '../auth/types'
import { toClientConfig } from '../config/to-client-config'
import type { Config } from '../config/types'
import { resolveEmailConfig, sendEmailWithTemplate } from '../email'
import { registerApiKeyRoutes } from './routes/api-keys'
import { registerEndpointRoutes } from './routes/endpoints'
import { registerCollectionRoutes } from './routes/collection'
import { registerFirstUserRoutes } from './routes/first-user'
import { registerGlobalRoutes } from './routes/global'
import { registerPermissionsRoutes } from './routes/permissions'
import { registerSearchRoutes } from './routes/search'
import { registerUserRoutes } from './routes/users'

export interface CreateLontarOptions {
  basePath?: string
  baseURL?: string
  adminPath?: string
  trustedOrigins?: string[]
  trustedProxies?: string[]
  ipAddressHeaders?: string[]
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
    roles.map((r) => [r, defaultAc.newRole({ user: [], session: [] })]),
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
  '/send-verification-email': { window: 60, max: 3 },
  '/verify-email': { window: 60, max: 10 },
}

function validateRateLimitStorage(storage?: string): void {
  if (storage && storage !== 'memory' && storage !== 'database') {
    throw new Error(
      `Invalid rateLimit.storage "${String(storage)}". Supported storage options are "memory" or "database" (or provide customStorage).`,
    )
  }
}

function buildRateLimitConfig(options: CreateLontarOptions) {
  const rateLimit = options.rateLimit
  if (!rateLimit) {
    return {
      enabled: resolveRateLimitEnabled(options),
      customRules: DEFAULT_BETTER_AUTH_CUSTOM_RULES,
    }
  }

  validateRateLimitStorage(rateLimit.storage)

  const config: Record<string, unknown> = {
    enabled: resolveRateLimitEnabled(options),
    customRules: {
      ...DEFAULT_BETTER_AUTH_CUSTOM_RULES,
      ...rateLimit.customRules,
    },
  }

  if (rateLimit.storage) config.storage = rateLimit.storage
  if (rateLimit.customStorage) config.customStorage = rateLimit.customStorage
  if (rateLimit.window !== undefined) config.window = rateLimit.window
  if (rateLimit.max !== undefined) config.max = rateLimit.max

  return config
}

function createSendResetPasswordHandler(
  getAuth: () => Auth,
  options: CreateLontarOptions,
  resolvedEmail: NonNullable<ReturnType<typeof resolveEmailConfig>>,
) {
  return async (data: { user: { id: string; email: string; name?: string }; token: string }) => {
    await deleteUserResetTokens(getAuth(), data.user.id, data.token)
    const adminUrl = await resolveAdminBaseUrl(getAuth(), options)
    if (!adminUrl) {
      console.warn(
        '[auth] Refusing to send password reset email: baseURL or BETTER_AUTH_URL must be configured',
      )
      return
    }
    const resetUrl = `${adminUrl}/reset-password?token=${data.token}`
    void sendEmailWithTemplate(resolvedEmail, 'resetPassword', {
      user: { id: data.user.id, email: data.user.email, name: data.user.name },
      url: resetUrl,
      token: data.token,
    }).catch((err) => {
      console.error('[auth] Failed to send password reset email:', err)
    })
  }
}

function createSendVerificationEmailHandler(
  getAuth: () => Auth,
  options: CreateLontarOptions,
  resolvedEmail: NonNullable<ReturnType<typeof resolveEmailConfig>>,
) {
  return async (data: { user: { id: string; email: string; name?: string }; token: string }) => {
    const adminUrl = await resolveAdminBaseUrl(getAuth(), options)
    if (!adminUrl) {
      console.warn(
        '[auth] Refusing to send verification email: baseURL or BETTER_AUTH_URL must be configured',
      )
      return
    }
    const verifyUrl = `${adminUrl}/verify-email?token=${data.token}`
    await sendEmailWithTemplate(resolvedEmail, 'verifyEmail', {
      user: { id: data.user.id, email: data.user.email, name: data.user.name },
      url: verifyUrl,
      token: data.token,
    })
  }
}

function buildAuthInstance(
  config: Config,
  basePath: string,
  options: CreateLontarOptions,
  ipConfig: { ipAddressHeaders: string[]; trustedProxies?: string[] },
): Auth {
  const trustedOrigins = buildTrustedOrigins(options)
  const resolvedEmail = resolveEmailConfig(config.email)

  const auth: Auth = betterAuth({
    secret: config.secret,
    basePath: `${basePath}/auth`,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),
    ...(config.db.authAdapter ? { database: config.db.authAdapter } : {}),
    advanced: {
      backgroundTasks: {
        handler: (task: Promise<unknown>) => {
          task.catch((err) => {
            console.error('[auth] Background task error:', err)
          })
        },
      },
      ipAddress: {
        ipAddressHeaders: ipConfig.ipAddressHeaders,
        ...(ipConfig.trustedProxies?.length ? { trustedProxies: ipConfig.trustedProxies } : {}),
      },
    },
    plugins: [buildAdminPlugin(config.auth), apiKeyPlugin()],
    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      ...(resolvedEmail
        ? {
            sendVerificationEmail: createSendVerificationEmailHandler(
              () => auth,
              options,
              resolvedEmail,
            ),
          }
        : {}),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: Boolean(config.auth?.requireEmailVerification),
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }: { user: { id: string } }) => {
        const ctx = await auth.$context
        await ctx.internalAdapter.updateUser(user.id, {
          emailVerified: true,
          updatedAt: new Date(),
        })
        await deleteUserResetTokens(auth, user.id)
      },
      ...(resolvedEmail
        ? {
            sendResetPassword: createSendResetPasswordHandler(() => auth, options, resolvedEmail),
          }
        : {}),
    },
    rateLimit: buildRateLimitConfig(options),
  })
  return auth
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
  clientIp?: string,
): Promise<ApiKeyAuthResult> {
  const ip = clientIp ?? rateLimiter.getClientIp(rawReq)

  // Reject blocked IPs before touching the DB, so floods of invalid keys are cheap
  // and a correct guess past the limit does not succeed (#413).
  const blocked = await rateLimiter.checkApiKeyFailureLimit(ip)
  if (!blocked.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many failed API key attempts. Please try again later.',
      retryAfter: blocked.retryAfter ?? rateLimiter.rules.apiKeyFailure.window,
    }
  }

  const result = await verifyApiKey(auth, apiKeyToken)
  if (result.valid && result.user) {
    return { ok: true, user: result.user, apiKey: result.apiKey ?? null }
  }

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
    if (err instanceof LockTimeoutError) {
      return c.json({ error: 'Another operation is in progress. Please retry.' }, 503, {
        'Retry-After': '1',
      })
    }
    console.error(err)
    return c.json({ error: 'Internal Server Error' }, 500)
  }

  app.onError(defaultErrorHandler)
  router.onError(defaultErrorHandler)

  const ipConfig = resolveIpResolutionOptions({
    trustedProxies: options.trustedProxies ?? options.rateLimit?.trustedProxies,
    ipAddressHeaders: options.ipAddressHeaders ?? options.rateLimit?.ipAddressHeaders,
  })

  const auth = buildAuthInstance(config, basePath, options, ipConfig)

  const rateLimiter = new RateLimiter(
    {
      ...options.rateLimit,
      trustedProxies: ipConfig.trustedProxies,
      ipAddressHeaders: ipConfig.ipAddressHeaders,
    },
    async () => {
      const ctx = await auth.$context
      return ctx.adapter as unknown as DatabaseAdapterLike
    },
  )

  // Attach client IP on all requests for unified resolution
  router.use('*', async (c, next) => {
    c.set('clientIp', rateLimiter.getClientIp(c.req.raw))
    await next()
  })

  // Block Better Auth's built-in admin plugin endpoints (defense in depth):
  // Lontar provides its own user management routes (/api/_lontar/users/*) with strict guards
  // (last-admin protection, self-demotion/disable/delete guards, session revocation, single-role validation).
  router.all('/auth/admin', (c) => c.json({ error: 'Not Found' }, 404))
  router.all('/auth/admin/*', (c) => c.json({ error: 'Not Found' }, 404))

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
    const cache = createFieldAccessCache()
    c.set('fieldAccessCache', cache)
    requestFieldAccessCache.set(c.req.raw, cache)

    const apiKeyToken = extractApiKeyToken(c.req.header('x-api-key'), c.req.header('authorization'))

    if (apiKeyToken) {
      const authResult = await authenticateApiKey(
        c.req.raw,
        auth,
        apiKeyToken,
        rateLimiter,
        c.get('clientIp'),
      )
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

  // Custom endpoints: after the session middleware, before every built-in route
  registerEndpointRoutes(router, config, rateLimiter)

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

  registerSearchRoutes(router, config)

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
