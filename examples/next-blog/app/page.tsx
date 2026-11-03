import Link from 'next/link'
import config from '@/lontar.config'
import { getLontar } from '@lontar/core'
import type { Category, Post } from '@/lontar-types'
import { PostCard } from '@/app/components/PostCard'

export const dynamic = 'force-dynamic'

interface HomePageProps {
  searchParams?: Promise<{ category?: string }>
}

function filterPostsByCategory(
  posts: Post[],
  categories: Category[],
  categoryKey?: string,
): Post[] {
  if (!categoryKey) return posts
  const matched = categories.find((c) => c.slug === categoryKey || String(c.id) === categoryKey)
  if (!matched) return posts

  return posts.filter((p) => {
    if (!Array.isArray(p.categories)) return false
    return p.categories.some((cat) => {
      if (typeof cat === 'object' && cat !== null) {
        return cat.id === matched.id
      }
      return cat === matched.id
    })
  })
}

function CategoryFilter({
  categories,
  activeCategory,
}: {
  categories: Category[]
  activeCategory?: string
}) {
  if (categories.length === 0) return null

  return (
    <section
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '2.5rem',
      }}
    >
      <Link
        href="/"
        style={{
          padding: '0.4rem 0.85rem',
          borderRadius: '9999px',
          fontSize: '0.875rem',
          fontWeight: 500,
          textDecoration: 'none',
          backgroundColor: !activeCategory ? '#0f172a' : '#f1f5f9',
          color: !activeCategory ? '#ffffff' : '#475569',
        }}
      >
        All
      </Link>
      {categories.map((cat) => {
        const isSelected = activeCategory === cat.slug || activeCategory === String(cat.id)
        return (
          <Link
            key={cat.id}
            href={isSelected ? '/' : `/?category=${encodeURIComponent(cat.slug || cat.id)}`}
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '9999px',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
              backgroundColor: isSelected ? '#0f172a' : '#f1f5f9',
              color: isSelected ? '#ffffff' : '#475569',
            }}
          >
            {cat.name}
          </Link>
        )
      })}
    </section>
  )
}

function EmptyState({ activeCategory }: { activeCategory?: string }) {
  return (
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
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#334155', margin: '0 0 0.5rem' }}>
        No published posts found
      </h2>
      <p style={{ color: '#64748b', margin: '0 0 1.5rem', fontSize: '0.9375rem' }}>
        {activeCategory
          ? 'There are no published articles in this category yet.'
          : 'Sign in to the Admin Panel to publish your first blog post.'}
      </p>
      <Link
        href="/admin"
        style={{
          display: 'inline-block',
          padding: '0.5rem 1rem',
          backgroundColor: '#2563eb',
          color: '#ffffff',
          borderRadius: '6px',
          textDecoration: 'none',
          fontWeight: 500,
          fontSize: '0.875rem',
        }}
      >
        Create a post in Admin &rarr;
      </Link>
    </div>
  )
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedParams = searchParams ? await searchParams : {}
  const activeCategory = resolvedParams.category

  const lontar = await getLontar(config)

  const [categoriesRes, postsRes] = await Promise.all([
    lontar.find('categories', { limit: 50, sort: 'name' }),
    lontar.find('posts', {
      where: { status: { equals: 'published' } },
      sort: '-publishedAt',
      limit: 20,
      depth: 1,
    }),
  ])

  const categories = categoriesRes.docs
  const rawPosts = postsRes.docs
  const posts = filterPostsByCategory(rawPosts, categories, activeCategory)

  return (
    <main style={{ maxWidth: '1040px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <section style={{ marginBottom: '3rem', textAlign: 'center' }}>
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            letterSpacing: '-0.025em',
            margin: '0 0 1rem',
            color: '#0f172a',
          }}
        >
          Insights, Stories &amp; Tutorials
        </h1>
        <p
          style={{
            fontSize: '1.125rem',
            color: '#64748b',
            maxWidth: '640px',
            margin: '0 auto',
            lineHeight: 1.6,
          }}
        >
          A blog powered by Lontar CMS. Content, relationships, rich text, and responsive media
          served seamlessly through the Local API.
        </p>
      </section>

      <CategoryFilter categories={categories} activeCategory={activeCategory} />

      {posts.length === 0 ? (
        <EmptyState activeCategory={activeCategory} />
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
