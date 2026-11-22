import { useCallback, useState } from 'react'

/** Prefixed so it cannot collide with the host application's own keys. */
export const SIDEBAR_STORAGE_KEY = 'lontar-admin-sidebar-collapsed'

// localStorage rather than a cookie: the admin shares the host app's cookies. It can be missing or
// throw (private windows, blocked site data), and the sidebar is then expanded and stays a
// per-session choice. The sidebar only renders after the session loads in the browser, so reading
// the stored value in the first render cannot disagree with the server.
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '1')
    else window.localStorage.removeItem(SIDEBAR_STORAGE_KEY)
  } catch {
    // Storage unavailable: keep the in-memory choice.
  }
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      writeCollapsed(!prev)
      return !prev
    })
  }, [])

  return { collapsed, toggle }
}
