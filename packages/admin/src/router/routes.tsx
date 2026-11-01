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
import { LoginView } from '../views/LoginView'
import { NotFoundView } from '../views/NotFoundView'

function CreateForm() {
  return <CollectionFormView mode="create" />
}

function EditForm() {
  return <CollectionFormView mode="edit" />
}

export function createAdminRouter(options: { basePath?: string; history?: RouterHistory }) {
  const rootRoute = createRootRoute({
    component: Outlet,
    notFoundComponent: NotFoundView,
  })

  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: LoginView,
  })

  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: 'authenticated',
    component: AdminLayout,
  })

  const indexRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/',
    component: DashboardView,
  })

  const collectionRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
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
    loginRoute,
    authenticatedRoute.addChildren([
      indexRoute,
      collectionRoute.addChildren([createRoutePath, editRoute, listRoute]),
    ]),
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
