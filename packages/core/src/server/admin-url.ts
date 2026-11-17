import type { Auth } from '../auth/types'

export interface AdminUrlOptions {
  baseURL?: string
  adminPath?: string
}

function parseOrigin(urlStr?: string | null): string | null {
  if (!urlStr) {
    return null
  }
  try {
    return new URL(urlStr).origin
  } catch {
    return null
  }
}

async function getAuthContextOrigin(auth?: Auth | null): Promise<string | null> {
  if (!auth) {
    return null
  }
  try {
    const ctx = await auth.$context
    return parseOrigin(ctx.baseURL)
  } catch {
    return null
  }
}

/**
 * Resolves the admin panel base URL for outgoing auth emails (password reset, email verification, invites).
 *
 * Security: NEVER uses the client request's Host header or request.url to determine the origin.
 * Origin is resolved strictly from:
 * 1. options.baseURL
 * 2. (await auth.$context).baseURL (set by Better Auth or BETTER_AUTH_URL env)
 * 3. process.env.BETTER_AUTH_URL
 *
 * Returns null if no origin can be resolved securely.
 */
export async function resolveAdminBaseUrl(
  auth?: Auth | null,
  options?: AdminUrlOptions,
): Promise<string | null> {
  const origin =
    parseOrigin(options?.baseURL) ??
    (await getAuthContextOrigin(auth)) ??
    parseOrigin(process.env.BETTER_AUTH_URL)

  if (!origin) {
    return null
  }

  const rawPath = options?.adminPath ?? '/admin'
  const adminPath = rawPath.replace(/\/$/, '')
  return `${origin}${adminPath}`
}
