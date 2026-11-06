import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useAdmin } from '../context/AdminContext'
import { ViewHeader, ViewSubtitle } from './ViewHeader'

const gridClass = 'lt:grid lt:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] lt:gap-5'

function EntityCard({
  title,
  slug,
  children,
}: {
  title: string
  slug: string
  children: ReactNode
}) {
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

export function DashboardView() {
  const { config } = useAdmin()

  return (
    <div>
      <ViewHeader title="Dashboard">
        <ViewSubtitle>Manage your content collections</ViewSubtitle>
      </ViewHeader>

      <div className={gridClass}>
        {config.collections.map((col) => (
          <EntityCard key={col.slug} title={col.labels.plural} slug={col.slug}>
            <Button asChild variant="outline">
              <Link to="/$collection" params={{ collection: col.slug }}>
                View {col.labels.plural}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/$collection/create" params={{ collection: col.slug }}>
                Create {col.labels.singular}
              </Link>
            </Button>
          </EntityCard>
        ))}
      </div>

      {config.globals && config.globals.length > 0 && (
        <div className="lt:mt-8">
          <ViewHeader title="Globals" level={2}>
            <ViewSubtitle>Manage singleton content documents</ViewSubtitle>
          </ViewHeader>
          <div className={gridClass}>
            {config.globals.map((g) => (
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
