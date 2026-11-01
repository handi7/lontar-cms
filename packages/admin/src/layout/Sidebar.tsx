import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'

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

  const initial = (user?.name?.[0] || user?.email?.[0] || 'A').toUpperCase()

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
      </nav>

      {user && (
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
            onClick={() => {
              void handleSignOut()
            }}
            disabled={isSigningOut}
            className="lontar-logout-button"
            aria-label="Sign out"
          >
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      )}
    </aside>
  )
}
