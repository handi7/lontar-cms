import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import config from '@/lontar.config'
import { getLontar } from '@lontar/core'
import type { SiteSettings } from '@/lontar-types'

export const metadata: Metadata = {
  title: 'Next.js Blog with Lontar CMS',
  description: 'A modern, TypeScript-first headless CMS blog example',
}

async function getSiteSettings(): Promise<SiteSettings | null> {
  try {
    const lontar = await getLontar(config)
    return await lontar.findGlobal('site-settings')
  } catch {
    return null
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const settings = await getSiteSettings()
  const siteName = settings?.siteName || 'Lontar Blog'
  const footerText =
    settings?.footerText || 'Powered by Lontar CMS • An open-source, TypeScript-first headless CMS.'

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          backgroundColor: '#f8fafc',
          color: '#0f172a',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            position: 'sticky',
            top: 0,
            zIndex: 40,
          }}
        >
          <div
            style={{
              maxWidth: '1040px',
              margin: '0 auto',
              padding: '1rem 1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Link
              href="/"
              data-testid="site-title"
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: '#0f172a',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>{siteName}</span>
            </Link>
            <nav style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <Link
                href="/"
                style={{
                  color: '#475569',
                  textDecoration: 'none',
                  fontSize: '0.9375rem',
                  fontWeight: 500,
                }}
              >
                Articles
              </Link>
              <Link
                href="/admin"
                data-testid="nav-admin"
                style={{
                  padding: '0.4rem 0.85rem',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  textDecoration: 'none',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                Admin Panel &rarr;
              </Link>
            </nav>
          </div>
        </header>

        <div style={{ flex: 1 }}>{children}</div>

        <footer
          style={{
            borderTop: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            marginTop: 'auto',
          }}
        >
          <div
            style={{
              maxWidth: '1040px',
              margin: '0 auto',
              padding: '2rem 1.5rem',
              color: '#64748b',
              fontSize: '0.875rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <p data-testid="footer-text" style={{ margin: 0 }}>
              {footerText}
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
