import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { CollectionBreadcrumbs, GlobalBreadcrumbs } from './FormBreadcrumbs'

describe('FormBreadcrumbs', () => {
  afterEach(cleanup)

  it('renders CollectionBreadcrumbs with link to collection and current title', async () => {
    const rootRoute = createRootRoute()
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <CollectionBreadcrumbs
          collectionLabel="Posts"
          collectionSlug="posts"
          currentTitle="My Blog Post"
        />
      ),
    })
    const collectionRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/$collection',
      component: () => <div>Collection page</div>,
    })
    const routeTree = rootRoute.addChildren([indexRoute, collectionRoute])
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    render(<RouterProvider router={router} />)

    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(nav).toBeTruthy()

    const link = screen.getByRole('link', { name: 'Posts' })
    expect(link.getAttribute('href')).toBe('/posts')

    const current = screen.getByText('My Blog Post')
    expect(current.getAttribute('aria-current')).toBe('page')
  })

  it('renders GlobalBreadcrumbs with static prefix and global label', () => {
    render(<GlobalBreadcrumbs label="Site Settings" />)

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav).toBeTruthy()
    expect(screen.getByText('Globals')).toBeTruthy()
    const current = screen.getByText('Site Settings')
    expect(current.getAttribute('aria-current')).toBe('page')
  })
})
