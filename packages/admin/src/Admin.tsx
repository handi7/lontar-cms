export interface AdminProps {
  /** Base URL the REST API is mounted at. */
  apiBase?: string
  /** Base path the admin itself is mounted at, used for routing. */
  basePath?: string
}

export function Admin({ apiBase = '/api', basePath = '/admin' }: AdminProps) {
  return (
    <div className="lontar-admin">
      <p>
        Lontar admin, mounted at <code>{basePath}</code>, talking to <code>{apiBase}</code>.
      </p>
    </div>
  )
}
