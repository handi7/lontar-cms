import { Link } from '@tanstack/react-router'
import { useAdmin } from '../context/AdminContext'

export function Sidebar() {
  const { config } = useAdmin()

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
    </aside>
  )
}
