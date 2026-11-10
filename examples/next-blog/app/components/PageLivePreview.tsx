'use client'

import { useLivePreview } from '@lontar/preview/react'
import type { Page } from '@/lontar-types'
import { BlockRenderer } from '@/app/components/BlockRenderer'

export interface PageLivePreviewProps {
  initialPage: Page
  serverUrl?: string
}

export function PageLivePreview({ initialPage, serverUrl }: PageLivePreviewProps) {
  const defaultServerUrl =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'

  const { data: page } = useLivePreview<Page>({
    initialData: initialPage,
    serverURL: serverUrl || defaultServerUrl,
    collection: 'pages',
  })

  return (
    <article
      data-testid="cms-page"
      style={{
        maxWidth: '1040px',
        margin: '0 auto',
        padding: '2rem 1.5rem 4rem',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {page._status === 'draft' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <span
            data-testid="preview-badge"
            style={{
              padding: '0.25rem 0.625rem',
              borderRadius: '9999px',
              backgroundColor: '#fef3c7',
              color: '#92400e',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Draft Preview
          </span>
        </div>
      )}

      <header style={{ marginBottom: '2rem' }}>
        <h1
          data-testid="page-title"
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            letterSpacing: '-0.025em',
            margin: '0 0 0.5rem',
            color: '#0f172a',
          }}
        >
          {page.title}
        </h1>
      </header>

      <BlockRenderer blocks={page.layout} />
    </article>
  )
}
