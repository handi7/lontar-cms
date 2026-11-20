import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import config from '@/lontar.config'
import { getLontar, sanitizeDocRead, type DocumentData } from '@lontar/core'
import type { Locale, Page } from '@/lontar-types'
import { PageLivePreview } from '@/app/components/PageLivePreview'
import { getSessionUser, isEditorLoggedIn } from '@/app/lib/auth'

export const dynamic = 'force-dynamic'

function isValidLocale(loc: string): loc is Locale {
  return loc === 'en' || loc === 'id'
}

interface LocalePageProps {
  params: Promise<{ locale: string; slug: string }>
  searchParams?: Promise<{ preview?: string; draft?: string }>
}

async function getPage(
  slug: string,
  locale: Locale,
  options: { draft?: boolean } = {},
): Promise<Page | null> {
  const lontar = await getLontar(config)

  const { docs } = await lontar.find('pages', {
    where: { slug: { equals: slug } },
    depth: 1,
    limit: 1,
    draft: options.draft,
    locale,
  })

  if (docs.length > 0) return docs[0]

  if (locale !== 'en') {
    const { docs: enDocs } = await lontar.find('pages', {
      where: { slug: { equals: slug } },
      depth: 1,
      limit: 1,
      draft: options.draft,
      locale: 'en',
    })
    if (enDocs.length > 0) {
      return await lontar.findByID('pages', enDocs[0].id, {
        depth: 1,
        draft: options.draft,
        locale,
      })
    }
  }

  const numericId = Number(slug)
  if (!Number.isNaN(numericId) && numericId > 0) {
    try {
      return await lontar.findByID('pages', numericId, {
        depth: 1,
        draft: options.draft,
        locale,
      })
    } catch {
      return null
    }
  }

  return null
}

function isPreviewRequested(searchParams?: { preview?: string; draft?: string }): boolean {
  if (!searchParams) return false
  return searchParams.preview === '1' || searchParams.draft === 'true'
}

async function sanitizePageDoc(rawPage: Page, isPreview: boolean, locale: Locale): Promise<Page> {
  const user = isPreview ? await getSessionUser() : null
  const pagesCollection = config.collections.find((c) => c.slug === 'pages')
  if (!pagesCollection) return rawPage
  return (await sanitizeDocRead(pagesCollection.fields, rawPage as unknown as DocumentData, user, {
    id: rawPage.id,
    doc: rawPage as unknown as DocumentData,
    locale,
  })) as unknown as Page
}

async function resolvePageForRequest(
  params: LocalePageProps['params'],
  searchParams?: LocalePageProps['searchParams'],
): Promise<{ page: Page | null; isPreview: boolean; locale: string }> {
  const { locale, slug } = await params
  if (!isValidLocale(locale)) {
    return { page: null, isPreview: false, locale }
  }

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const previewRequested = isPreviewRequested(resolvedSearchParams)
  const isPreview = previewRequested && (await isEditorLoggedIn())
  const rawPage = await getPage(slug, locale, { draft: isPreview })
  if (!rawPage) {
    return { page: null, isPreview, locale }
  }
  if (!isPreview && rawPage._status !== 'published') {
    return { page: null, isPreview, locale }
  }

  const page = await sanitizePageDoc(rawPage, isPreview, locale)
  return { page, isPreview, locale }
}

export async function generateMetadata({
  params,
  searchParams,
}: LocalePageProps): Promise<Metadata> {
  const { page } = await resolvePageForRequest(params, searchParams)
  if (!page) {
    return { title: 'Page Not Found' }
  }

  return {
    title: page.seo?.metaTitle || `${page.title} | Lontar Blog`,
    description: page.seo?.metaDescription || undefined,
  }
}

export default async function CMSLocalePage({ params, searchParams }: LocalePageProps) {
  const { page, locale } = await resolvePageForRequest(params, searchParams)

  if (!page) {
    notFound()
  }

  return <PageLivePreview initialPage={page} locale={locale} />
}
