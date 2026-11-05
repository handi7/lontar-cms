import { Navigate, Outlet, useRouter } from '@tanstack/react-router'
import { useAuth } from '../context/AuthContext'
import { Sidebar } from './Sidebar'

export function AdminLayout() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  if (isLoading) {
    return (
      <div className="lontar-init-loading">
        <div className="lontar-spinner" />
        <p>Checking authentication...</p>
      </div>
    )
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

  return (
    <div className="lontar-layout">
      <Sidebar />
      <main className="lontar-main">
        <div className="lontar-main-inner">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
