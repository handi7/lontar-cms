import { Navigate, Outlet, useRouter } from '@tanstack/react-router'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'
import { FullPageLoading } from './FullPageState'
import { Sidebar } from './Sidebar'

export function AdminLayout() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const { isLoading: isPermissionsLoading } = usePermissions()
  const router = useRouter()

  if (isAuthLoading) {
    return <FullPageLoading>Checking authentication...</FullPageLoading>
  }

  if (!user) {
    const pathname = router.state.location.pathname
    const redirectPath =
      pathname && pathname !== '/' && pathname !== '/login' ? pathname : undefined
    return (
      <Navigate
        to="/login"
        search={redirectPath ? { redirect: redirectPath } : undefined}
        replace
      />
    )
  }

  if (isPermissionsLoading) {
    return <FullPageLoading>Loading permissions...</FullPageLoading>
  }

  return (
    <div className="lt:flex lt:min-h-screen lt:flex-col lt:md:flex-row">
      <Sidebar />
      {/* min-w-0 is load-bearing: a flex item defaults to min-width: auto, so
          without it a wide list table pushes the whole row past the viewport
          instead of scrolling inside its own container. */}
      <main className="lt:min-w-0 lt:flex-1 lt:bg-background">
        <div className="lt:w-full lt:px-4 lt:md:px-10 lt:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
