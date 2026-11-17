import { headers } from 'next/headers'
import type { AuthUser } from '@lontar/core'

export async function getSessionUser(): Promise<AuthUser | null> {
  try {
    const headerList = await headers()
    const cookie = headerList.get('cookie')
    if (!cookie) return null

    const port = process.env.PORT || '3000'
    const baseUrl = process.env.LONTAR_URL || `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/_lontar/me`, {
      headers: { cookie },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { user?: AuthUser }
    return data.user ?? null
  } catch {
    return null
  }
}

export async function isEditorLoggedIn(): Promise<boolean> {
  const user = await getSessionUser()
  return Boolean(user && (user.role === 'admin' || user.role === 'editor'))
}
