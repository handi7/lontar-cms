import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import config from '@/lontar.config'
import { getLontar } from '@lontar/core'
import type { Category, Locale } from '@/lontar-types'
import { PostCard } from '@/app/components/PostCard'

export const dynamic = 'force-dynamic'

function isValidLocale(loc: string): loc is Locale {
  return loc === 'en' || loc === 'id'
}

interface LocaleCategoryPageProps {
  params: Promise<{ locale: string; slug: string }>
}

async function getCategory(slug: string): Promise<Category | null> {
  const lontar = await getLontar(config)
  const { docs } = await lontar.find('categories', {
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: false,
  })
  if (docs.length > 0) return docs[0]

  const numericId = Number(slug)
  if (!Number.isNaN(numericId) && numericId > 0) {
    try {
      return await lontar.findByID('categories', numericId, { overrideAccess: false })
    } catch {
      return null
    }
  }

  return null
}

export async function generateMetadata({ params }: LocaleCategoryPageProps): Promise<Metadata> {
  const { slug } = await params
  const category = await getCategory(slug)
  if (!category) {
    return { title: 'Category Not Found' }
  }
  return {
    title: `${category.name} | Lontar Blog`,
    description: `Articles categorized under ${category.name}`,
  }
}

export default async function LocaleCategoryPage({ params }: LocaleCategoryPageProps) {
  const { locale, slug } = await params
  if (!isValidLocale(locale)) {
    notFound()
  }

  const category = await getCategory(slug)
  if (!category) {
    notFound()
  }

  const lontar = await getLontar(config)
  const { docs } = await lontar.find('posts', {
    sort: '-publishedAt',
    limit: 50,
    depth: 1,
    overrideAccess: false,
    locale,
  })

  const posts = docs.filter((p) => {
    if (!Array.isArray(p.categories)) return false
    return p.categories.some((cat) => {
      if (typeof cat === 'object' && cat !== null) {
        return cat.id === category.id
      }
      return cat === category.id
    })
  })

  return (
    <main style={{ maxWidth: '1040px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <Link
          href={`/${locale}`}
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
      </div>

      <header style={{ marginBottom: '3rem' }}>
        <div
          style={{
            fontSize: '0.8125rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: '#2563eb',
            marginBottom: '0.5rem',
          }}
        >
          Category
        </div>
        <h1
          data-testid="category-title"
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            letterSpacing: '-0.025em',
            margin: '0 0 0.5rem',
            color: '#0f172a',
          }}
        >
          {category.name}
        </h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: '1rem' }}>
          {posts.length} {posts.length === 1 ? 'article' : 'articles'} in this category
        </p>
      </header>

      {posts.length === 0 ? (
        <div
          data-testid="no-posts"
          style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
          }}
        >
          <h2
            style={{
              fontSize: '1.25rem',
              fontWeight: 600,
              color: '#334155',
              margin: '0 0 0.5rem',
            }}
          >
            No published posts in this category
          </h2>
          <Link
            href={`/${locale}`}
            style={{
              display: 'inline-block',
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: '0.875rem',
            }}
          >
            View all articles
          </Link>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '2rem',
          }}
        >
          {posts.map((post) => (
            <PostCard key={post.id} post={post} locale={locale} />
          ))}
        </div>
      )}
    </main>
  )
}
