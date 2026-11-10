import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import config from '@/lontar.config'
import { getLontar } from '@lontar/core'
import type { Page } from '@/lontar-types'
import { PageLivePreview } from '@/app/components/PageLivePreview'
import { isEditorLoggedIn } from '@/app/lib/auth'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ preview?: string; draft?: string }>
}

async function getPage(slug: string, options: { draft?: boolean } = {}): Promise<Page | null> {
  const lontar = await getLontar(config)

  const { docs } = await lontar.find('pages', {
    where: { slug: { equals: slug } },
    depth: 1,
    limit: 1,
    draft: options.draft,
  })

  if (docs.length > 0) return docs[0]

  const numericId = Number(slug)
  if (!Number.isNaN(numericId) && numericId > 0) {
    try {
      return await lontar.findByID('pages', numericId, {
        depth: 1,
        draft: options.draft,
      })
    } catch {
      return null
    }
  }

  return null
}

async function resolvePageForRequest(
  params: PageProps['params'],
  searchParams?: PageProps['searchParams'],
): Promise<{ page: Page | null; isPreview: boolean }> {
  const { slug } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const previewRequested =
    resolvedSearchParams.preview === '1' || resolvedSearchParams.draft === 'true'
  const isPreview = previewRequested && (await isEditorLoggedIn())
  const page = await getPage(slug, { draft: isPreview })
  const isVisible = page && (isPreview || page._status === 'published')
  return { page: isVisible ? page : null, isPreview }
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { page } = await resolvePageForRequest(params, searchParams)
  if (!page) {
    return { title: 'Page Not Found' }
  }

  return {
    title: page.seo?.metaTitle || `${page.title} | Lontar Blog`,
    description: page.seo?.metaDescription || undefined,
  }
}

export default async function CMSPage({ params, searchParams }: PageProps) {
  const { page } = await resolvePageForRequest(params, searchParams)

  if (!page) {
    notFound()
  }

  return <PageLivePreview initialPage={page} />
}
