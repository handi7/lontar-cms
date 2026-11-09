import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import config from '@/lontar.config'
import { getLontar } from '@lontar/core'
import type { Page } from '@/lontar-types'
import { BlockRenderer } from '@/app/components/BlockRenderer'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

async function getPage(slug: string): Promise<Page | null> {
  const lontar = await getLontar(config)

  const { docs } = await lontar.find('pages', {
    where: { slug: { equals: slug } },
    depth: 1,
    limit: 1,
  })

  if (docs.length > 0) return docs[0]

  const numericId = Number(slug)
  if (!Number.isNaN(numericId) && numericId > 0) {
    try {
      return await lontar.findByID('pages', numericId, { depth: 1 })
    } catch {
      return null
    }
  }

  return null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) {
    return { title: 'Page Not Found' }
  }

  return {
    title: page.seo?.metaTitle || `${page.title} | Lontar Blog`,
    description: page.seo?.metaDescription || undefined,
  }
}

export default async function CMSPage({ params }: PageProps) {
  const { slug } = await params
  const page = await getPage(slug)

  if (!page) {
    notFound()
  }

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
