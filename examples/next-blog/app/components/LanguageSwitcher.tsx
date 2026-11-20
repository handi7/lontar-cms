'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function LanguageSwitcher() {
  const pathname = usePathname() || '/'
  const isIndonesian = pathname.startsWith('/id')
  const activeLocale = isIndonesian ? 'id' : 'en'

  function getTargetUrl(targetLocale: 'en' | 'id') {
    if (targetLocale === 'id') {
      if (pathname.startsWith('/id')) return pathname
      if (pathname.startsWith('/en')) return pathname.replace(/^\/en/, '/id')
      if (pathname === '/') return '/id'
      return `/id${pathname}`
    } else {
      if (pathname.startsWith('/en')) return pathname
      if (pathname.startsWith('/id')) return pathname.replace(/^\/id/, '/en')
      if (pathname === '/') return '/en'
      return `/en${pathname}`
    }
  }

  return (
    <div
      data-testid="language-switcher"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        backgroundColor: '#f1f5f9',
        padding: '0.2rem 0.35rem',
        borderRadius: '6px',
        fontSize: '0.8125rem',
        fontWeight: 600,
      }}
    >
      <Link
        href={getTargetUrl('en')}
        data-testid="lang-option-en"
        style={{
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          textDecoration: 'none',
          backgroundColor: activeLocale === 'en' ? '#0f172a' : 'transparent',
          color: activeLocale === 'en' ? '#ffffff' : '#64748b',
          transition: 'all 0.15s ease',
        }}
      >
        EN
      </Link>
      <Link
        href={getTargetUrl('id')}
        data-testid="lang-option-id"
        style={{
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          textDecoration: 'none',
          backgroundColor: activeLocale === 'id' ? '#0f172a' : 'transparent',
          color: activeLocale === 'id' ? '#ffffff' : '#64748b',
          transition: 'all 0.15s ease',
        }}
      >
        ID
      </Link>
    </div>
  )
}
