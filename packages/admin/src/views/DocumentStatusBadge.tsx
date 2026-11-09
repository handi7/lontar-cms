import { Badge } from '../components/ui/badge'

export type DocumentStatus = 'draft' | 'published' | 'changed'

export function getDocumentStatus(
  doc: { _status?: string; _isPublished?: boolean } | null | undefined,
): DocumentStatus {
  if (!doc) return 'draft'
  if (doc._status === 'published') return 'published'
  if (doc._isPublished) return 'changed'
  return 'draft'
}

export interface DocumentStatusBadgeProps {
  status?: DocumentStatus
  doc?: { _status?: string; _isPublished?: boolean } | null
  className?: string
}

const STATUS_LABELS: Record<DocumentStatus, string> = {
  published: 'Published',
  changed: 'Changed',
  draft: 'Draft',
}

const STATUS_VARIANTS: Record<DocumentStatus, 'success' | 'default' | 'secondary'> = {
  published: 'success',
  changed: 'default',
  draft: 'secondary',
}

export function DocumentStatusBadge({ status, doc, className }: DocumentStatusBadgeProps) {
  const resolvedStatus: DocumentStatus = status ?? getDocumentStatus(doc)

  return (
    <Badge
      variant={STATUS_VARIANTS[resolvedStatus]}
      className={className}
      data-status={resolvedStatus}
    >
      {STATUS_LABELS[resolvedStatus]}
    </Badge>
  )
}
