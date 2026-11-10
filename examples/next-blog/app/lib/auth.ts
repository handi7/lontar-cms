import { headers } from 'next/headers'

export async function isEditorLoggedIn(): Promise<boolean> {
  try {
    const headerList = await headers()
    const cookie = headerList.get('cookie')
    if (!cookie) return false

    const port = process.env.PORT || '3000'
    const baseUrl = process.env.LONTAR_URL || `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/_lontar/me`, {
      headers: { cookie },
      cache: 'no-store',
    })
    if (!res.ok) return false
    const data = (await res.json()) as { user?: unknown }
    return Boolean(data.user)
  } catch {
    return false
  }
}
