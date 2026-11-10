import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import config from '@/lontar.config'
import { getLontar } from '@lontar/core'
import type { Post } from '@/lontar-types'
import { PostLivePreview } from '@/app/components/PostLivePreview'
import { isEditorLoggedIn } from '@/app/lib/auth'

export const dynamic = 'force-dynamic'

interface PostPageProps {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ preview?: string; draft?: string }>
}

async function getPost(slug: string, options: { draft?: boolean } = {}): Promise<Post | null> {
  const lontar = await getLontar(config)

  const { docs } = await lontar.find('posts', {
    where: { slug: { equals: slug } },
    depth: 1,
    limit: 1,
    draft: options.draft,
  })

  if (docs.length > 0) return docs[0]

  const numericId = Number(slug)
  if (!Number.isNaN(numericId) && numericId > 0) {
    try {
      return await lontar.findByID('posts', numericId, {
        depth: 1,
        draft: options.draft,
      })
    } catch {
      return null
    }
  }

  return null
}

async function resolvePostForRequest(
  params: PostPageProps['params'],
  searchParams?: PostPageProps['searchParams'],
): Promise<{ post: Post | null; isPreview: boolean }> {
  const { slug } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const previewRequested =
    resolvedSearchParams.preview === '1' || resolvedSearchParams.draft === 'true'
  const isPreview = previewRequested && (await isEditorLoggedIn())
  const post = await getPost(slug, { draft: isPreview })
  const isVisible = post && (isPreview || post._status === 'published')
  return { post: isVisible ? post : null, isPreview }
}

export async function generateMetadata({ params, searchParams }: PostPageProps): Promise<Metadata> {
  const { post } = await resolvePostForRequest(params, searchParams)
  if (!post) {
    return { title: 'Post Not Found' }
  }
  return {
    title: `${post.title} | Lontar Blog`,
    description: `Read ${post.title} on Lontar Blog`,
  }
}

export default async function PostPage({ params, searchParams }: PostPageProps) {
  const { post } = await resolvePostForRequest(params, searchParams)

  if (!post) {
    notFound()
  }

  return <PostLivePreview initialPost={post} />
}
