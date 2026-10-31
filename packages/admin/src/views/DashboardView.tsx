import { Link } from '@tanstack/react-router'
import { useAdmin } from '../context/AdminContext'

export function DashboardView() {
  const { config } = useAdmin()

  return (
    <div className="lontar-dashboard">
      <header className="lontar-view-header">
        <h1>Dashboard</h1>
        <p className="lontar-subtitle">Manage your content collections</p>
      </header>

      <div className="lontar-collection-grid">
        {config.collections.map((col) => (
          <div key={col.slug} className="lontar-card">
            <h3>{col.labels.plural}</h3>
            <p className="lontar-card-slug">{col.slug}</p>
            <div className="lontar-card-actions">
              <Link
                to="/$collection"
                params={{ collection: col.slug }}
                className="lontar-btn lontar-btn-secondary"
              >
                View {col.labels.plural}
              </Link>
              <Link
                to="/$collection/create"
                params={{ collection: col.slug }}
                className="lontar-btn lontar-btn-primary"
              >
                Create {col.labels.singular}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
