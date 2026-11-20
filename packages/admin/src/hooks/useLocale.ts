import { useContext } from 'react'
import { useSearch } from '@tanstack/react-router'
import { AdminContext } from '../context/AdminContext'

export interface UseLocaleResult {
  hasLocalization: boolean
  activeLocale: string | undefined
  defaultLocale: string | undefined
  fallbackLocale: string | undefined
  locales: Array<{ code: string; label: string }>
}

function resolveWindowSearchLocale(): string | undefined {
  if (typeof window === 'undefined' || !window.location?.search) return undefined
  const params = new URLSearchParams(window.location.search)
  const val = params.get('locale')
  return val && val.trim() ? val : undefined
}

function resolveSearchLocale(): string | undefined {
  try {
    const search: unknown = useSearch({ strict: false })
    if (search && typeof search === 'object' && 'locale' in search) {
      const loc = (search as { locale?: unknown }).locale
      if (typeof loc === 'string' && loc.trim()) return loc
    }
  } catch {
    // Router context not ready or strict mismatch in non-router environments
  }
  return resolveWindowSearchLocale()
}

export function useLocale(): UseLocaleResult {
  const ctx = useContext(AdminContext)
  const localization = ctx?.config?.localization
  const searchLocale = resolveSearchLocale()

  if (!localization || !localization.locales || localization.locales.length === 0) {
    return {
      hasLocalization: false,
      activeLocale: undefined,
      defaultLocale: undefined,
      fallbackLocale: undefined,
      locales: [],
    }
  }

  const validCodes = localization.locales.map((l) => l.code)
  const activeLocale =
    searchLocale && validCodes.includes(searchLocale) ? searchLocale : localization.defaultLocale

  const fallbackLocale = localization.fallback !== false ? localization.defaultLocale : undefined

  return {
    hasLocalization: true,
    activeLocale,
    defaultLocale: localization.defaultLocale,
    fallbackLocale,
    locales: localization.locales,
  }
}
