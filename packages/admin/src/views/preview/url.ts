export interface ResolvedPreviewUrl {
  ready: boolean
  missingTokens: string[]
  url?: string
  origin?: string
}

const TOKEN_PATTERN = /\{([a-zA-Z0-9_]+)\}/g

function findMissingTokens(template: string, values: Record<string, unknown>): string[] {
  const missing: string[] = []
  const matches = template.matchAll(TOKEN_PATTERN)
  for (const match of matches) {
    const token = match[1]
    if (!token) continue
    const val = values[token]
    const isEmpty =
      val === undefined || val === null || (typeof val === 'string' && val.trim() === '')

    if (isEmpty && !missing.includes(token)) {
      missing.push(token)
    }
  }
  return missing
}

function formatTokenValue(val: unknown): string {
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val)
  }
  return ''
}

function resolveOrigin(url: string): string | undefined {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost'
    return new URL(url, base).origin
  } catch {
    return undefined
  }
}

/**
 * Resolves a preview URL template against document values.
 * Replaces `{token}` placeholders with URL-encoded values.
 * Returns `ready: false` with the list of missing tokens if any placeholder cannot be resolved.
 */
export function resolvePreviewUrl(
  template: string,
  values: Record<string, unknown>,
): ResolvedPreviewUrl {
  const missingTokens = findMissingTokens(template, values)
  if (missingTokens.length > 0) {
    return {
      ready: false,
      missingTokens,
    }
  }

  const resolvedUrl = template.replace(TOKEN_PATTERN, (_match, token: string) => {
    return encodeURIComponent(formatTokenValue(values[token]))
  })

  return {
    ready: true,
    missingTokens: [],
    url: resolvedUrl,
    origin: resolveOrigin(resolvedUrl),
  }
}
