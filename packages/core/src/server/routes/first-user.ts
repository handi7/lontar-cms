import type { Hono } from 'hono'
import type { Auth, LontarVariables } from '../../auth/types'
import { countTotalUsers, createUserWithCredential } from '../../auth/user'

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

export function registerFirstUserRoutes(
  router: Hono<{ Variables: LontarVariables }>,
  auth: Auth,
): void {
  router.get('/_lontar/first-user', async (c) => {
    const totalUsers = await countTotalUsers(auth)
    return c.json({ canRegisterFirstUser: totalUsers === 0, totalUsers })
  })

  router.post('/_lontar/first-user', async (c) => {
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

    await createUserWithCredential(auth, validated.data)

    return auth.api.signInEmail({
      body: {
        email: validated.data.email,
        password: validated.data.password,
      },
      asResponse: true,
    })
  })
}
