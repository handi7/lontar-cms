import { Link } from '@tanstack/react-router'

export function NotFoundView() {
  return (
    <div className="lontar-not-found">
      <h2>Page Not Found</h2>
      <p>The requested page or collection does not exist.</p>
      <Link to="/" className="lontar-btn lontar-btn-secondary">
        Return to Dashboard
      </Link>
    </div>
  )
}
