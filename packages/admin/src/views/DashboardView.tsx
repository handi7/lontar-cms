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

      {config.globals && config.globals.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <header className="lontar-view-header">
            <h2>Globals</h2>
            <p className="lontar-subtitle">Manage singleton content documents</p>
          </header>
          <div className="lontar-collection-grid">
            {config.globals.map((g) => (
              <div key={g.slug} className="lontar-card">
                <h3>{g.label}</h3>
                <p className="lontar-card-slug">{g.slug}</p>
                <div className="lontar-card-actions">
                  <Link
                    to="/globals/$slug"
                    params={{ slug: g.slug }}
                    className="lontar-btn lontar-btn-primary"
                  >
                    Edit {g.label}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
