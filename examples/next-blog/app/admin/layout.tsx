import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Lontar Admin',
}

// The admin gets its own root layout so the blog's header, footer and body
// styles in app/(web)/layout.tsx don't wrap the admin SPA.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
