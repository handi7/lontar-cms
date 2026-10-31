import { Outlet } from '@tanstack/react-router'
import { Sidebar } from './Sidebar'

export function AdminLayout() {
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
