import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// The editor's theme choice (docs/adr/0020). 'system' is the default and is
// handled entirely in CSS by a prefers-color-scheme query, so it needs no
// attribute and no listener; 'light' and 'dark' set data-theme on the
// .lontar-admin wrapper.

export type ThemePreference = 'light' | 'dark' | 'system'

/** Prefixed so it cannot collide with the host application's own keys. */
export const THEME_STORAGE_KEY = 'lontar-admin-theme'

// localStorage can be missing or throw (private windows, blocked site data, a
// sandboxed iframe). The choice then lasts for the session only.
function readStoredTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function writeStoredTheme(theme: ThemePreference): void {
  try {
    if (theme === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
  } catch {
    // Storage unavailable: keep the in-memory choice.
  }
}

/**
 * Reads the stored choice only once `mounted` is true. The admin's first
 * render must match the server's, and the server cannot see localStorage, so
 * reading earlier would make React report a hydration mismatch on the
 * wrapper's data-theme.
 */
export function useThemePreference(mounted: boolean) {
  const [theme, setThemeState] = useState<ThemePreference>('system')

  useEffect(() => {
    if (mounted) setThemeState(readStoredTheme())
  }, [mounted])

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    writeStoredTheme(next)
  }, [])

  return useMemo(
    () => ({
      theme,
      setTheme,
      /** Value for the wrapper's data-theme attribute; absent means system. */
      dataTheme: theme === 'system' ? undefined : theme,
    }),
    [theme, setTheme],
  )
}

interface ThemeContextValue {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeContext provider')
  }
  return ctx
}
