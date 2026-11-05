import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import { useInsertionEffect, useState } from 'react'
import type { ClientConfig } from '@lontar/core/client'
import { Admin } from '../Admin'
import { createAdminBrowserHistory } from './history'

const mockConfig: ClientConfig = {
  version: 1,
  collections: [
    {
      slug: 'posts',
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title', defaultColumns: ['id', 'title'] },
      fields: [{ name: 'title', label: 'Title', type: 'text', required: true }],
    },
  ],
  globals: [],
}

function mockJsonResponse(data: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }),
  )
}

// Mimics Next.js's app router, which writes the URL with replaceState from inside
// useInsertionEffect (`HistoryUpdater` in next/dist/client/components/app-router.js).
let rerenderHost: () => void = () => {}
function HostHistoryUpdater() {
  const [tick, setTick] = useState(0)
  rerenderHost = () => setTick((t) => t + 1)
  useInsertionEffect(() => {
    if (tick > 0) window.history.replaceState(window.history.state, '', window.location.href)
  }, [tick])
  return null
}

describe('admin browser history', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not schedule router updates when the host app writes history in useInsertionEffect', async () => {
    window.history.replaceState(null, '', '/admin')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/_lontar/config')) return mockJsonResponse(mockConfig)
        if (url.includes('/auth/get-session')) {
          return mockJsonResponse({
            user: { id: 'u1', name: 'Admin', email: 'admin@example.com' },
            session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 1e7) },
          })
        }
        return mockJsonResponse({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 })
      }),
    )
    const consoleError = vi.spyOn(console, 'error')

    render(
      <>
        <HostHistoryUpdater />
        <Admin apiBase="/api" basePath="/admin" />
      </>,
    )
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeTruthy()

    await act(async () => {
      rerenderHost()
      await Promise.resolve()
    })

    const messages = consoleError.mock.calls.map((args) => String(args[0]))
    expect(messages.filter((m) => m.includes('useInsertionEffect must not schedule'))).toEqual([])
  })

  it('still notifies the router about history writes made outside it', async () => {
    window.history.replaceState(null, '', '/admin')
    const history = createAdminBrowserHistory()
    const listener = vi.fn()
    const unsubscribe = history.subscribe(listener)

    window.history.pushState(null, '', '/admin/posts')
    expect(listener).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(history.location.pathname).toBe('/admin/posts')

    unsubscribe()
    history.destroy()
  })

  it('notifies synchronously for navigations made through the history itself', () => {
    window.history.replaceState(null, '', '/admin')
    const history = createAdminBrowserHistory()
    const listener = vi.fn()
    history.subscribe(listener)

    history.push('/admin/posts')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ action: { type: 'PUSH' } }))

    history.destroy()
  })
})
