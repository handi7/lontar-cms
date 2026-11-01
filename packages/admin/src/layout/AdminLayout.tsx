import { Navigate, Outlet } from '@tanstack/react-router'
import { useAuth } from '../context/AuthContext'
import { Sidebar } from './Sidebar'

export function AdminLayout() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="lontar-init-loading">
        <div className="lontar-spinner" />
        <p>Checking authentication...</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" />
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
