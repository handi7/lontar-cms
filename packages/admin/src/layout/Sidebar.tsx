import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { ClientGlobal } from '@lontar/core/client'
import type { AdminUser } from '../api/client'
import { useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'

function GlobalsNav({ globals }: { globals?: ClientGlobal[] }) {
  if (!globals || globals.length === 0) return null
  return (
    <div className="lontar-nav-group">
      <div className="lontar-nav-title">Globals</div>
      {globals.map((g) => (
        <Link
          key={g.slug}
          to="/globals/$slug"
          params={{ slug: g.slug }}
          activeProps={{ className: 'active' }}
          className="lontar-nav-link"
        >
          {g.label}
        </Link>
      ))}
    </div>
  )
}

function SidebarUserProfile({
  user,
  onSignOut,
  isSigningOut,
}: {
  user: AdminUser
  onSignOut: () => void
  isSigningOut: boolean
}) {
  const initial = (user.name?.[0] || user.email?.[0] || 'A').toUpperCase()

  return (
    <div className="lontar-sidebar-footer">
      <div className="lontar-user-profile">
        <div className="lontar-user-avatar">{initial}</div>
        <div className="lontar-user-info">
          <span className="lontar-user-name">{user.name || 'Admin'}</span>
          <span className="lontar-user-email">{user.email}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        disabled={isSigningOut}
        className="lontar-logout-button"
        aria-label="Sign out"
      >
        {isSigningOut ? 'Signing out...' : 'Sign out'}
      </button>
    </div>
  )
}

export function Sidebar() {
  const { config } = useAdmin()
  const { user, signOut } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await signOut()
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <aside className="lontar-sidebar">
      <div className="lontar-sidebar-brand">
        <Link to="/" className="lontar-brand-link">
          <span className="lontar-brand-icon">L</span>
          <span className="lontar-brand-name">Lontar CMS</span>
        </Link>
      </div>

      <nav className="lontar-nav">
        <div className="lontar-nav-group">
          <Link
            to="/"
            activeProps={{ className: 'active' }}
            activeOptions={{ exact: true }}
            className="lontar-nav-link"
          >
            Dashboard
          </Link>
        </div>

        <div className="lontar-nav-group">
          <div className="lontar-nav-title">Collections</div>
          {config.collections.map((col) => (
            <Link
              key={col.slug}
              to="/$collection"
              params={{ collection: col.slug }}
              activeProps={{ className: 'active' }}
              className="lontar-nav-link"
            >
              {col.labels.plural}
            </Link>
          ))}
        </div>

        <GlobalsNav globals={config.globals} />
      </nav>

      {user && (
        <SidebarUserProfile
          user={user}
          onSignOut={() => {
            void handleSignOut()
          }}
          isSigningOut={isSigningOut}
        />
      )}
    </aside>
  )
}
