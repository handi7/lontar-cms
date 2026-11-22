import { useMemo, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import { CustomComponent } from '../components/CustomComponent'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useAdmin } from '../context/AdminContext'
import { usePermissions } from '../context/PermissionsContext'
import type { DashboardWidgetProps } from './dashboard-widget-props'
import { ViewHeader, ViewSubtitle } from './ViewHeader'

const gridClass = 'lt:grid lt:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] lt:gap-5'

interface EntityCardProps {
  title: string
  slug: string
  children: ReactNode
}

function EntityCard({ title, slug, children }: EntityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3 className="lt:m-0 lt:text-xl lt:font-semibold">{title}</h3>
        </CardTitle>
        <CardDescription className="lt:font-mono lt:text-[0.8125rem]">{slug}</CardDescription>
      </CardHeader>
      <CardContent className="lt:flex lt:flex-wrap lt:gap-2.5">{children}</CardContent>
    </Card>
  )
}

/** Full-width widgets span both columns; narrow containers stack everything in one. */
const widgetClass = {
  full: 'lt:@3xl:col-span-2',
  half: 'lt:@3xl:col-span-1',
} as const

function DashboardWidgets() {
  const { config } = useAdmin()
  const widgets = config.admin?.dashboard?.widgets
  if (!widgets || widgets.length === 0) return null
  return (
    // The container makes the `@3xl` classes follow the width of this area, not the viewport.
    <div className="lt:@container lt:mb-8">
      <div className="lt:grid lt:grid-cols-1 lt:gap-5 lt:@3xl:grid-cols-2">
        {widgets.map((widget, index) => {
          const props: DashboardWidgetProps = { width: widget.width }
          return (
            <div
              // The same component may be configured twice, so the position is the identity.
              key={index}
              className={`lt:min-w-0 ${widgetClass[widget.width]}`}
              data-testid={`dashboard-widget-${widget.component}`}
              data-width={widget.width}
            >
              <CustomComponent name={widget.component} componentProps={props} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DashboardView() {
  const { config } = useAdmin()
  const { canReadCollection, canCreateInCollection, canReadGlobal } = usePermissions()

  const visibleCollections = useMemo(
    () => config.collections.filter((col) => canReadCollection(col.slug)),
    [config.collections, canReadCollection],
  )

  const visibleGlobals = useMemo(
    () => config.globals?.filter((g) => canReadGlobal(g.slug)) ?? [],
    [config.globals, canReadGlobal],
  )

  return (
    <div>
      <ViewHeader title="Dashboard">
        <ViewSubtitle>Manage your content collections</ViewSubtitle>
      </ViewHeader>

      <DashboardWidgets />

      <div className={gridClass}>
        {visibleCollections.map((col) => {
          const canCreate = canCreateInCollection(col.slug)
          return (
            <EntityCard key={col.slug} title={col.labels.plural} slug={col.slug}>
              <Button asChild variant="outline">
                <Link to="/$collection" params={{ collection: col.slug }}>
                  View {col.labels.plural}
                </Link>
              </Button>
              {canCreate && (
                <Button asChild>
                  <Link to="/$collection/create" params={{ collection: col.slug }}>
                    Create {col.labels.singular}
                  </Link>
                </Button>
              )}
            </EntityCard>
          )
        })}
      </div>

      {visibleGlobals.length > 0 && (
        <div className="lt:mt-8">
          <ViewHeader title="Globals" level={2}>
            <ViewSubtitle>Manage singleton content documents</ViewSubtitle>
          </ViewHeader>
          <div className={gridClass}>
            {visibleGlobals.map((g) => (
              <EntityCard key={g.slug} title={g.label} slug={g.slug}>
                <Button asChild>
                  <Link to="/globals/$slug" params={{ slug: g.slug }}>
                    Edit {g.label}
                  </Link>
                </Button>
              </EntityCard>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
