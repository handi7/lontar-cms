import { useParams } from '@tanstack/react-router'
import { CustomComponent } from '../components/CustomComponent'
import { useAdmin } from '../context/AdminContext'
import { usePermissions } from '../context/PermissionsContext'
import type { CustomViewProps } from './custom-view-props'
import { NotFoundView } from './NotFoundView'
import { ViewHeader } from './ViewHeader'

/**
 * `<basePath>/views/<key>`: a registered component with a page title. A key the config does not
 * list and a view the user may not see look the same (the not-found page), so a hidden view does
 * not reveal that it exists.
 */
export function CustomViewRoute() {
  const { key } = useParams({ strict: false })
  const { config } = useAdmin()
  const { canViewCustomView, isPermissionsLoading } = usePermissions()

  const view = config.admin?.views?.find((candidate) => candidate.key === key)
  if (!view) return <NotFoundView />
  if (isPermissionsLoading) {
    return (
      <p role="status" className="lt:text-muted-foreground">
        Loading…
      </p>
    )
  }
  if (!canViewCustomView(view.key)) return <NotFoundView />

  const props: CustomViewProps = { viewKey: view.key, label: view.label }
  return (
    <div data-testid={`custom-view-${view.key}`}>
      <ViewHeader title={view.label} />
      <CustomComponent name={view.component} componentProps={props} />
    </div>
  )
}
