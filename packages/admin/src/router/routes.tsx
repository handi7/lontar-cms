import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { AdminLayout } from '../layout/AdminLayout'
import { AccountView } from '../views/AccountView'
import { CollectionFormView } from '../views/CollectionFormView'
import { CollectionListView } from '../views/CollectionListView'
import { DashboardView } from '../views/DashboardView'
import { GlobalFormView } from '../views/GlobalFormView'
import { LoginView } from '../views/LoginView'
import { NotFoundView } from '../views/NotFoundView'
import { UsersView } from '../views/UsersView'

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

  const usersRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'users',
    component: UsersView,
  })

  const accountRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'account',
    component: AccountView,
  })

  const globalRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'globals/$slug',
    component: GlobalFormView,
    remountDeps: ({ params }) => params,
  })

  const collectionRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '$collection',
    component: Outlet,
    remountDeps: ({ params }) => params,
  })

  const listRoute = createRoute({
    getParentRoute: () => collectionRoute,
    path: '/',
    component: CollectionListView,
    remountDeps: ({ params }) => params,
  })

  const createRoutePath = createRoute({
    getParentRoute: () => collectionRoute,
    path: 'create',
    component: CreateForm,
    remountDeps: ({ params }) => params,
  })

  const editRoute = createRoute({
    getParentRoute: () => collectionRoute,
    path: '$id',
    component: EditForm,
    remountDeps: ({ params }) => params,
  })

  const routeTree = rootRoute.addChildren([
    loginRoute,
    authenticatedRoute.addChildren([
      indexRoute,
      usersRoute,
      accountRoute,
      globalRoute,
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
