import Link from 'next/link'

export default function HomePage() {
  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Lontar CMS Next.js Blog Example</h1>
      <p>This example demonstrates Lontar CMS mounted in a Next.js application.</p>
      <div style={{ marginTop: '1.5rem' }}>
        <Link
          href="/admin"
          style={{
            display: 'inline-block',
            padding: '0.625rem 1.25rem',
            backgroundColor: '#2563eb',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: '6px',
            fontWeight: 500,
          }}
        >
          Go to Admin Panel &rarr;
        </Link>
      </div>
    </main>
  )
}
