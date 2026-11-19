import type { Config } from '../config/types'
import { ValidationError } from './errors'

export function extractLocaleCodes(config: Config): string[] {
  if (!config.localization) return []
  return config.localization.locales.map((l) => (typeof l === 'string' ? l : l.code))
}

export function resolveOperationLocale(
  config: Config,
  locale?: string,
  fallbackLocale?: string | false,
): { locale?: string; fallbackLocale?: string | false } {
  const localization = config.localization
  if (!localization) {
    if (locale !== undefined && locale !== '') {
      throw new ValidationError('Validation failed', {
        issues: [{ path: 'locale', message: `Unknown locale "${locale}"` }],
      })
    }
    if (fallbackLocale !== undefined && fallbackLocale !== '') {
      throw new ValidationError('Validation failed', {
        issues: [
          {
            path: 'fallbackLocale',
            message: `Unknown fallback locale "${String(fallbackLocale)}"`,
          },
        ],
      })
    }
    return {}
  }

  const validCodes = extractLocaleCodes(config)
  const resolvedLocale = resolveRequestedLocale(locale, validCodes, localization.defaultLocale)
  const resolvedFallback = resolveRequestedFallback(fallbackLocale, validCodes)

  return { locale: resolvedLocale, fallbackLocale: resolvedFallback }
}

function resolveRequestedLocale(
  locale: string | undefined,
  validCodes: string[],
  defaultLocale: string,
): string {
  if (locale !== undefined && locale !== '') {
    if (locale !== 'all' && !validCodes.includes(locale)) {
      throw new ValidationError('Validation failed', {
        issues: [{ path: 'locale', message: `Unknown locale "${locale}"` }],
      })
    }
    return locale
  }
  return defaultLocale
}

function resolveRequestedFallback(
  fallbackLocale: string | false | undefined,
  validCodes: string[],
): string | false | undefined {
  if (fallbackLocale === undefined || fallbackLocale === '') {
    return undefined
  }
  if (fallbackLocale === false || fallbackLocale === 'false' || fallbackLocale === 'none') {
    return false
  }
  if (validCodes.includes(fallbackLocale)) {
    return fallbackLocale
  }
  throw new ValidationError('Validation failed', {
    issues: [
      { path: 'fallbackLocale', message: `Unknown fallback locale "${String(fallbackLocale)}"` },
    ],
  })
}
