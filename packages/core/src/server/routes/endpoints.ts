import type { Context, Hono } from 'hono'
import type { RateLimiter } from '../../auth/rate-limit'
import type { LontarVariables } from '../../auth/types'
import { checkAccess } from '../../access'
import type { Config, Endpoint, EndpointContext } from '../../config/types'
import { createLontarClient } from '../../local'

type LontarEnv = { Variables: LontarVariables }

function parseEndpointId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

async function enforceRateLimit(
  c: Context<LontarEnv>,
  endpoint: Endpoint,
  key: string,
  rateLimiter?: RateLimiter,
): Promise<Response | null> {
  if (!endpoint.rateLimit || !rateLimiter) return null
  const ip = c.get('clientIp') ?? rateLimiter.getClientIp(c.req.raw)
  const result = await rateLimiter.consume(`endpoint:${key}:${ip}`, endpoint.rateLimit)
  if (result.allowed) return null
  const retryAfter = String(result.retryAfter ?? endpoint.rateLimit.window)
  return c.json({ error: 'Too many requests. Please try again later.' }, 429, {
    'Retry-After': retryAfter,
    'X-Retry-After': retryAfter,
  })
}

/** 401 without a user, 403 for an API key on a session-only endpoint or a failing access check. */
async function authorize(
  c: Context<LontarEnv>,
  endpoint: Endpoint,
  id: number | undefined,
  locale: string | undefined,
): Promise<Response | null> {
  const user = c.get('user') ?? null
  if (user && c.get('apiKey') && !endpoint.apiKey) {
    return c.json({ error: 'This endpoint does not accept API keys' }, 403)
  }
  if (!endpoint.access) {
    return user ? null : c.json({ error: 'Authentication required' }, 401)
  }
  const allowed = await checkAccess(endpoint.access, { user, id, req: c.req.raw, locale })
  if (allowed) return null
  return user
    ? c.json({ error: 'Forbidden' }, 403)
    : c.json({ error: 'Authentication required' }, 401)
}

function mountEndpoint(
  router: Hono<LontarEnv>,
  config: Config,
  rateLimiter: RateLimiter | undefined,
  prefix: string,
  scopeKey: string,
  endpoint: Endpoint,
): void {
  router.on(endpoint.method.toUpperCase(), `${prefix}${endpoint.path}`, async (c) => {
    const limited = await enforceRateLimit(c, endpoint, `${scopeKey}:${endpoint.name}`, rateLimiter)
    if (limited) return limited

    let id: number | undefined
    const rawId = c.req.param('id' as never) as string | undefined
    if (rawId !== undefined) {
      const parsed = parseEndpointId(rawId)
      if (parsed === null) return c.json({ error: 'Invalid ID' }, 400)
      id = parsed
    }
    const locale = c.req.query('locale')

    const denied = await authorize(c, endpoint, id, locale)
    if (denied) return denied

    const user = c.get('user') ?? null
    const ctx: EndpointContext = {
      user,
      apiKey: c.get('apiKey') ?? null,
      id,
      locale,
      config,
      lontar: createLontarClient(config, { overrideAccess: false, user }),
    }
    return endpoint.handler(c, ctx)
  })
}

/**
 * Registers custom endpoints (ADR 0029). Call after the session and API key middleware and before
 * the built-in routes, so a custom path is never shadowed. The config validator keeps custom
 * paths from overlapping built-in routes.
 */
export function registerEndpointRoutes(
  router: Hono<LontarEnv>,
  config: Config,
  rateLimiter?: RateLimiter,
): void {
  for (const endpoint of config.endpoints ?? []) {
    mountEndpoint(router, config, rateLimiter, '', 'root', endpoint)
  }
  for (const collection of config.collections) {
    for (const endpoint of collection.endpoints ?? []) {
      mountEndpoint(router, config, rateLimiter, `/${collection.slug}`, collection.slug, endpoint)
    }
  }
  for (const global of config.globals ?? []) {
    for (const endpoint of global.endpoints ?? []) {
      mountEndpoint(
        router,
        config,
        rateLimiter,
        `/globals/${global.slug}`,
        `globals/${global.slug}`,
        endpoint,
      )
    }
  }
}
