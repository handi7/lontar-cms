import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ClientConfig } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { useLocale } from './useLocale'

function createAdminWrapper(config: Partial<ClientConfig>) {
  const fullConfig = {
    collections: [],
    globals: [],
    ...config,
  } as unknown as ClientConfig

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AdminContext.Provider value={{ config: fullConfig, apiBase: '/api', basePath: '/admin' }}>
        {children}
      </AdminContext.Provider>
    )
  }
}

describe('useLocale (#428)', () => {
  it('returns hasLocalization=false when localization is not configured', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: createAdminWrapper({}),
    })

    expect(result.current.hasLocalization).toBe(false)
    expect(result.current.activeLocale).toBeUndefined()
    expect(result.current.locales).toEqual([])
  })

  it('resolves defaultLocale as activeLocale when no URL search param exists', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: createAdminWrapper({
        localization: {
          locales: [
            { code: 'en', label: 'English' },
            { code: 'id', label: 'Bahasa Indonesia' },
          ],
          defaultLocale: 'en',
          fallback: true,
        },
      }),
    })

    expect(result.current.hasLocalization).toBe(true)
    expect(result.current.activeLocale).toBe('en')
    expect(result.current.defaultLocale).toBe('en')
    expect(result.current.fallbackLocale).toBe('en')
    expect(result.current.locales).toHaveLength(2)
  })

  it('resolves activeLocale from window.location.search when valid', () => {
    window.history.pushState({}, '', '/admin/posts/1?locale=id')

    const { result } = renderHook(() => useLocale(), {
      wrapper: createAdminWrapper({
        localization: {
          locales: [
            { code: 'en', label: 'English' },
            { code: 'id', label: 'Bahasa Indonesia' },
          ],
          defaultLocale: 'en',
          fallback: true,
        },
      }),
    })

    expect(result.current.activeLocale).toBe('id')

    // Clean up URL
    window.history.pushState({}, '', '/')
  })

  it('falls back to defaultLocale if URL search param is unknown', () => {
    window.history.pushState({}, '', '/admin/posts/1?locale=unknown')

    const { result } = renderHook(() => useLocale(), {
      wrapper: createAdminWrapper({
        localization: {
          locales: [
            { code: 'en', label: 'English' },
            { code: 'id', label: 'Bahasa Indonesia' },
          ],
          defaultLocale: 'en',
          fallback: true,
        },
      }),
    })

    expect(result.current.activeLocale).toBe('en')

    // Clean up URL
    window.history.pushState({}, '', '/')
  })
})
