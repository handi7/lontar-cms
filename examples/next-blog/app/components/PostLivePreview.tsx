'use client'

import Link from 'next/link'
import { useLivePreview } from '@lontar/preview/react'
import type { Author, Category, Media, Post } from '@/lontar-types'
import { RichText } from '@/app/components/RichText'

export interface PostLivePreviewProps {
  initialPost: Post
  serverUrl?: string
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function PostMetaBar({
  author,
  publishedAt,
}: {
  author?: Author | null
  publishedAt?: string | null
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        paddingBottom: '1.5rem',
        marginBottom: '2rem',
        borderBottom: '1px solid #e2e8f0',
        color: '#64748b',
        fontSize: '0.9375rem',
      }}
    >
      {author && (
        <div data-testid="post-author" style={{ fontWeight: 600, color: '#0f172a' }}>
          By {author.name}
        </div>
      )}
      {publishedAt && <div data-testid="post-date">Published on {formatDate(publishedAt)}</div>}
    </div>
  )
}

function CategoryBadges({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
      {categories.map((c) => (
        <Link
          key={c.id}
          href={`/categories/${encodeURIComponent(c.slug || c.id)}`}
          style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#2563eb',
            backgroundColor: '#eff6ff',
            padding: '0.25rem 0.625rem',
            borderRadius: '4px',
            textDecoration: 'none',
          }}
        >
          {c.name}
        </Link>
      ))}
    </div>
  )
}

function CoverImage({ cover, title }: { cover?: Media | null; title: string }) {
  const coverUrl = cover?.sizes?.hero?.url || cover?.url
  if (!coverUrl) return null

  return (
    <div
      data-testid="post-cover"
      style={{
        marginBottom: '2.5rem',
        borderRadius: '12px',
        overflow: 'hidden',
        backgroundColor: '#e2e8f0',
        maxHeight: '480px',
      }}
    >
      <img
        src={coverUrl}
        alt={cover?.alt || title}
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: '480px',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  )
}

function AuthorBio({ author }: { author?: Author | null }) {
  if (!author) return null
  return (
    <section
      data-testid="author-bio"
      style={{
        marginTop: '3.5rem',
        padding: '1.5rem',
        borderRadius: '12px',
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div
        style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          color: '#64748b',
        }}
      >
        About the Author
      </div>
      <div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a' }}>{author.name}</div>
      {author.bio && (
        <p style={{ margin: 0, color: '#475569', lineHeight: 1.6, fontSize: '0.9375rem' }}>
          {author.bio}
        </p>
      )}
    </section>
  )
}

export function PostLivePreview({ initialPost, serverUrl }: PostLivePreviewProps) {
  const defaultServerUrl =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'

  const { data: post } = useLivePreview<Post>({
    initialData: initialPost,
    serverURL: serverUrl || defaultServerUrl,
    collection: 'posts',
  })

  const coverMedia = typeof post.cover === 'object' && post.cover !== null ? post.cover : null
  const author = typeof post.author === 'object' && post.author !== null ? post.author : null
  const categories = Array.isArray(post.categories)
    ? post.categories.filter((c): c is Category => typeof c === 'object' && c !== null)
    : []

  return (
    <article style={{ maxWidth: '820px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
        }}
      >
        <Link
          href="/"
          style={{
            color: '#64748b',
            textDecoration: 'none',
            fontSize: '0.875rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          &larr; Back to all articles
        </Link>

        {post._status === 'draft' && (
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
        )}
      </div>

      <CategoryBadges categories={categories} />

      <h1
        data-testid="post-title"
        style={{
          fontSize: '2.75rem',
          fontWeight: 800,
          letterSpacing: '-0.025em',
          lineHeight: 1.2,
          margin: '0 0 1.25rem',
          color: '#0f172a',
        }}
      >
        {post.title}
      </h1>

      <PostMetaBar author={author} publishedAt={post.publishedAt} />
      <CoverImage cover={coverMedia} title={post.title} />

      <div data-testid="post-content" style={{ fontSize: '1.0625rem' }}>
        <RichText content={post.content} />
      </div>

      <AuthorBio author={author} />
    </article>
  )
}
