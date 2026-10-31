import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { AdminLayout } from '../layout/AdminLayout'
import { DashboardView } from '../views/DashboardView'
import { CollectionListView } from '../views/CollectionListView'
import { CollectionFormView } from '../views/CollectionFormView'
import { NotFoundView } from '../views/NotFoundView'

function CreateForm() {
  return <CollectionFormView mode="create" />
}

function EditForm() {
  return <CollectionFormView mode="edit" />
}

export function createAdminRouter(options: { basePath?: string; history?: RouterHistory }) {
  const rootRoute = createRootRoute({
    component: AdminLayout,
    notFoundComponent: NotFoundView,
  })

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: DashboardView,
  })

  const collectionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$collection',
    component: Outlet,
  })

  const listRoute = createRoute({
    getParentRoute: () => collectionRoute,
    path: '/',
    component: CollectionListView,
  })

  const createRoutePath = createRoute({
    getParentRoute: () => collectionRoute,
    path: 'create',
    component: CreateForm,
  })

  const editRoute = createRoute({
    getParentRoute: () => collectionRoute,
    path: '$id',
    component: EditForm,
  })

  const routeTree = rootRoute.addChildren([
    indexRoute,
    collectionRoute.addChildren([createRoutePath, editRoute, listRoute]),
  ])

  return createRouter({
    routeTree,
    basepath: options.basePath,
    history: options.history,
  })
}

export type AdminRouter = ReturnType<typeof createAdminRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AdminRouter
  }
}
