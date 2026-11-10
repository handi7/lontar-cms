import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import config from '@/lontar.config'
import { getLontar } from '@lontar/core'
import type { Category } from '@/lontar-types'
import { PostCard } from '@/app/components/PostCard'

export const dynamic = 'force-dynamic'

interface CategoryPageProps {
  params: Promise<{ slug: string }>
}

async function getCategory(slug: string): Promise<Category | null> {
  const lontar = await getLontar(config)
  const { docs } = await lontar.find('categories', {
    where: { slug: { equals: slug } },
    limit: 1,
  })
  if (docs.length > 0) return docs[0]

  const numericId = Number(slug)
  if (!Number.isNaN(numericId) && numericId > 0) {
    try {
      return await lontar.findByID('categories', numericId)
    } catch {
      return null
    }
  }

  return null
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
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

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params
  const category = await getCategory(slug)

  if (!category) {
    notFound()
  }

  const lontar = await getLontar(config)
  const { docs } = await lontar.find('posts', {
    sort: '-publishedAt',
    limit: 50,
    depth: 1,
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
            fontSize: '2.25rem',
            fontWeight: 800,
            margin: '0 0 0.5rem',
            color: '#0f172a',
          }}
        >
          {category.name}
        </h1>
        <p style={{ color: '#64748b', margin: 0 }}>
          {posts.length} {posts.length === 1 ? 'article' : 'articles'} in this category
        </p>
      </header>

      {posts.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
          }}
        >
          <p style={{ color: '#64748b', margin: 0 }}>No published posts in this category yet.</p>
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
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </main>
  )
}
