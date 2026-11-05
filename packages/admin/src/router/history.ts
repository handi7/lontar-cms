import { createBrowserHistory, type RouterHistory } from '@tanstack/react-router'

/**
 * Browser history for the admin router.
 *
 * TanStack's browser history patches `window.history.pushState`/`replaceState` and
 * notifies its subscribers synchronously when code outside the router calls them.
 * Next.js's app router calls them from `useInsertionEffect`, so the router's state
 * update would run inside React's insertion-effect phase, which React rejects with
 * "useInsertionEffect must not schedule updates" (#100). Notifications caused by such
 * outside writes are moved to a microtask; the router's own navigations still notify
 * synchronously.
 */
export function createAdminBrowserHistory(): RouterHistory {
  const history = createBrowserHistory()
  let outsideWrite = false

  const asOutsideWrite =
    (write: History['pushState']): History['pushState'] =>
    (...args) => {
      const previous = outsideWrite
      outsideWrite = true
      try {
        write(...args)
      } finally {
        outsideWrite = previous
      }
    }

  // Wraps TanStack's patched methods. The router's own writes also pass through here,
  // but TanStack suppresses notifications for those, so the flag has no effect on them.
  window.history.pushState = asOutsideWrite(window.history.pushState.bind(window.history))
  window.history.replaceState = asOutsideWrite(window.history.replaceState.bind(window.history))

  const subscribe = history.subscribe
  history.subscribe = (listener) => {
    let active = true
    const unsubscribe = subscribe((event) => {
      if (!outsideWrite) return listener(event)
      queueMicrotask(() => {
        if (active) listener(event)
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }

  return history
}
