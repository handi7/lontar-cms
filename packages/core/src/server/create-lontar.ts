import { betterAuth } from 'better-auth'
import { Hono } from 'hono'
import type { Auth, AuthSession, AuthUser, LontarVariables } from '../auth/types'
import { toClientConfig } from '../config/to-client-config'
import type { Config } from '../config/types'
import { registerCollectionRoutes } from './routes/collection'

export interface CreateLontarOptions {
  basePath?: string
  baseURL?: string
}

export type LontarApp = Hono<{ Variables: LontarVariables }> & {
  readonly auth: Auth
}

export function createLontar(config: Config, options: CreateLontarOptions = {}): LontarApp {
  const app = new Hono<{ Variables: LontarVariables }>()
  const basePath = options.basePath ?? '/api'
  const router = new Hono<{ Variables: LontarVariables }>()

  const auth = betterAuth({
    secret: config.secret,
    basePath: `${basePath}/auth`,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(config.db.authAdapter ? { database: config.db.authAdapter } : {}),
    emailAndPassword: {
      enabled: true,
    },
  })

  // Mount Better Auth handler routes at /auth/*
  router.all('/auth/*', (c) => auth.handler(c.req.raw))

  // Session verification middleware for all subsequent routes
  router.use('*', async (c, next) => {
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      c.set('user', (session?.user as AuthUser) ?? null)
      c.set('session', (session?.session as AuthSession) ?? null)
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

  // Collection CRUD routes
  registerCollectionRoutes(router, config)

  app.route(basePath, router)
  ;(app as unknown as { auth: unknown }).auth = auth
  return app as LontarApp
}
