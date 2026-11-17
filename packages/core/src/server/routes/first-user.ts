import type { Context, Hono } from 'hono'
import type { RateLimiter } from '../../auth/rate-limit'
import type { Auth, LontarVariables } from '../../auth/types'
import { countTotalUsers, createUserWithCredential } from '../../auth/user'
import type { Config } from '../../config/types'

interface FirstUserBody {
  email?: string
  password?: string
  name?: string
}

function validateCredentials(email?: string, password?: string): string | null {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return 'A valid email is required'
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long'
  }
  return null
}

function validateFirstUserInput(body: unknown): {
  error?: string
  data?: { email: string; password: string; name: string }
} {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid JSON request body' }
  }
  const { email, password, name } = body as FirstUserBody

  if (!name || typeof name !== 'string' || !name.trim()) {
    return { error: 'Name is required' }
  }

  const credentialError = validateCredentials(email, password)
  if (credentialError) {
    return { error: credentialError }
  }

  return {
    data: {
      name: name.trim(),
      email: (email as string).trim().toLowerCase(),
      password: password as string,
    },
  }
}

async function checkFirstUserRateLimit(
  c: Context<{ Variables: LontarVariables }>,
  rateLimiter?: RateLimiter,
): Promise<Response | null> {
  if (!rateLimiter) return null
  const ip = c.get('clientIp') ?? rateLimiter.getClientIp(c.req.raw)
  const check = await rateLimiter.consume(`first-user:${ip}`, rateLimiter.rules.firstUser)
  if (!check.allowed) {
    const retryAfter = check.retryAfter ?? rateLimiter.rules.firstUser.window
    return c.json({ error: 'Too many requests. Please try again later.' }, 429, {
      'Retry-After': String(retryAfter),
      'X-Retry-After': String(retryAfter),
    })
  }
  return null
}

export function registerFirstUserRoutes(
  router: Hono<{ Variables: LontarVariables }>,
  auth: Auth,
  config?: Config,
  rateLimiter?: RateLimiter,
): void {
  router.get('/_lontar/first-user', async (c) => {
    const totalUsers = await countTotalUsers(auth)
    return c.json({ canRegisterFirstUser: totalUsers === 0, totalUsers })
  })

  router.post('/_lontar/first-user', async (c) => {
    const rateLimitError = await checkFirstUserRateLimit(c, rateLimiter)
    if (rateLimitError) return rateLimitError

    const totalUsers = await countTotalUsers(auth)
    if (totalUsers > 0) {
      return c.json({ error: 'First user has already been created' }, 403)
    }

    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON request body' }, 400)
    }

    const validated = validateFirstUserInput(rawBody)
    if (!validated.data) {
      return c.json({ error: validated.error }, 400)
    }

    const adminRole = config?.auth?.adminRole ?? 'admin'
    await createUserWithCredential(auth, {
      ...validated.data,
      role: adminRole,
      emailVerified: true,
    })

    return auth.api.signInEmail({
      body: {
        email: validated.data.email,
        password: validated.data.password,
      },
      asResponse: true,
    })
  })
}
