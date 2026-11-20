import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import config from '@/lontar.config'
import { getLontar, type AuthUser } from '@lontar/core'
import type { Locale, Post } from '@/lontar-types'
import { PostLivePreview } from '@/app/components/PostLivePreview'
import { getSessionUser, isEditorLoggedIn } from '@/app/lib/auth'

export const dynamic = 'force-dynamic'

function isValidLocale(loc: string): loc is Locale {
  return loc === 'en' || loc === 'id'
}

interface LocalePostPageProps {
  params: Promise<{ locale: string; slug: string }>
  searchParams?: Promise<{ preview?: string; draft?: string }>
}

async function getPostByNumericId(
  lontar: Awaited<ReturnType<typeof getLontar>>,
  slug: string,
  locale: Locale,
  options: { draft?: boolean; user?: AuthUser | null },
): Promise<Post | null> {
  const numericId = Number(slug)
  if (Number.isNaN(numericId) || numericId <= 0) return null
  try {
    return await lontar.findByID('posts', numericId, {
      depth: 1,
      draft: options.draft,
      overrideAccess: false,
      user: options.user ?? null,
      locale,
    })
  } catch {
    return null
  }
}

async function getPostFallbackByEnglishSlug(
  lontar: Awaited<ReturnType<typeof getLontar>>,
  slug: string,
  locale: Locale,
  options: { draft?: boolean; user?: AuthUser | null },
): Promise<Post | null> {
  if (locale === 'en') return null
  const { docs } = await lontar.find('posts', {
    where: { slug: { equals: slug } },
    depth: 1,
    limit: 1,
    draft: options.draft,
    overrideAccess: false,
    user: options.user ?? null,
    locale: 'en',
  })
  if (docs.length === 0) return null
  return lontar.findByID('posts', docs[0].id, {
    depth: 1,
    draft: options.draft,
    overrideAccess: false,
    user: options.user ?? null,
    locale,
  })
}

async function getPost(
  slug: string,
  locale: Locale,
  options: { draft?: boolean; user?: AuthUser | null } = {},
): Promise<Post | null> {
  const lontar = await getLontar(config)

  const { docs } = await lontar.find('posts', {
    where: { slug: { equals: slug } },
    depth: 1,
    limit: 1,
    draft: options.draft,
    overrideAccess: false,
    user: options.user ?? null,
    locale,
  })

  if (docs.length > 0) return docs[0]

  const fallbackDoc = await getPostFallbackByEnglishSlug(lontar, slug, locale, options)
  if (fallbackDoc) return fallbackDoc

  return getPostByNumericId(lontar, slug, locale, options)
}

async function resolvePostForRequest(
  params: LocalePostPageProps['params'],
  searchParams?: LocalePostPageProps['searchParams'],
): Promise<{ post: Post | null; isPreview: boolean; locale: string }> {
  const { locale, slug } = await params
  if (!isValidLocale(locale)) {
    return { post: null, isPreview: false, locale }
  }

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const previewRequested =
    resolvedSearchParams.preview === '1' || resolvedSearchParams.draft === 'true'
  const isPreview = previewRequested && (await isEditorLoggedIn())
  const user = isPreview ? await getSessionUser() : null
  const post = await getPost(slug, locale, { draft: isPreview, user })
  const isVisible = post && (isPreview || post._status === 'published')
  return { post: isVisible ? post : null, isPreview, locale }
}

export async function generateMetadata({
  params,
  searchParams,
}: LocalePostPageProps): Promise<Metadata> {
  const { post } = await resolvePostForRequest(params, searchParams)
  if (!post) {
    return { title: 'Post Not Found' }
  }
  return {
    title: `${post.title} | Lontar Blog`,
    description: post.excerpt || `Read ${post.title} on Lontar Blog`,
  }
}

export default async function LocalePostPage({ params, searchParams }: LocalePostPageProps) {
  const { post, locale } = await resolvePostForRequest(params, searchParams)

  if (!post) {
    notFound()
  }

  return <PostLivePreview initialPost={post} locale={locale} />
}
