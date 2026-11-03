import Link from 'next/link'
import type { Category, Post } from '@/lontar-types'

export interface PostCardProps {
  post: Post
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function getCover(cover: Post['cover']): { url: string; alt: string } | null {
  if (typeof cover !== 'object' || cover === null) return null
  const url = cover.sizes?.thumb?.url || cover.url
  if (!url) return null
  return { url, alt: cover.alt || '' }
}

function getAuthorName(author: Post['author']): string | null {
  if (typeof author !== 'object' || author === null) return null
  return author.name || null
}

function getCategories(categories: Post['categories']): Category[] {
  if (!Array.isArray(categories)) return []
  return categories.filter((c): c is Category => typeof c === 'object' && c !== null)
}

export function PostCard({ post }: PostCardProps) {
  const cover = getCover(post.cover)
  const authorName = getAuthorName(post.author)
  const postCategories = getCategories(post.categories)

  return (
    <article
      data-testid={`post-card-${post.id}`}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {cover && (
        <div
          style={{
            height: '200px',
            width: '100%',
            backgroundColor: '#e2e8f0',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <img
            src={cover.url}
            alt={cover.alt || post.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
      )}
      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
        {postCategories.length > 0 && (
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.75rem' }}
          >
            {postCategories.map((c) => (
              <Link
                key={c.id}
                href={`/categories/${encodeURIComponent(c.slug || c.id)}`}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#2563eb',
                  backgroundColor: '#eff6ff',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  textDecoration: 'none',
                }}
              >
                {c.name}
              </Link>
            ))}
          </div>
        )}

        <h2
          style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            margin: '0 0 0.75rem',
            lineHeight: 1.35,
          }}
        >
          <Link
            href={`/posts/${post.slug || post.id}`}
            style={{
              color: '#0f172a',
              textDecoration: 'none',
            }}
          >
            {post.title}
          </Link>
        </h2>

        <div
          style={{
            marginTop: 'auto',
            paddingTop: '1rem',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.8125rem',
            color: '#64748b',
          }}
        >
          {authorName ? (
            <span style={{ fontWeight: 500, color: '#334155' }}>By {authorName}</span>
          ) : (
            <span>Unknown Author</span>
          )}
          {post.publishedAt && <span>{formatDate(post.publishedAt)}</span>}
        </div>
      </div>
    </article>
  )
}
