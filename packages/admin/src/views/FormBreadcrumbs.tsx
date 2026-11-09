import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

export interface CollectionBreadcrumbsProps {
  collectionLabel: string
  collectionSlug: string
  currentTitle: string
}

export function CollectionBreadcrumbs({
  collectionLabel,
  collectionSlug,
  currentTitle,
}: CollectionBreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="lt:mb-3 lt:flex lt:items-center lt:gap-1.5 lt:text-sm lt:text-muted-foreground"
    >
      <Link
        to="/$collection"
        params={{ collection: collectionSlug }}
        className="lt:transition-colors lt:hover:text-foreground"
      >
        {collectionLabel}
      </Link>
      <ChevronRight className="lt:size-3.5 lt:text-muted-foreground/70" />
      <span className="lt:font-medium lt:text-foreground" aria-current="page">
        {currentTitle}
      </span>
    </nav>
  )
}

export interface GlobalBreadcrumbsProps {
  label: string
}

export function GlobalBreadcrumbs({ label }: GlobalBreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="lt:mb-3 lt:flex lt:items-center lt:gap-1.5 lt:text-sm lt:text-muted-foreground"
    >
      <span>Globals</span>
      <ChevronRight className="lt:size-3.5 lt:text-muted-foreground/70" />
      <span className="lt:font-medium lt:text-foreground" aria-current="page">
        {label}
      </span>
    </nav>
  )
}
