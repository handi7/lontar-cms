import type { ClientAction } from '@lontar/core/client'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import type { BulkKind, BulkSummary, RowId } from './bulk'

const VERB: Record<BulkKind, string> = {
  delete: 'Deleted',
  publish: 'Published',
  unpublish: 'Unpublished',
}

function plural(count: number, singular: string, pluralLabel: string): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`
}

export interface BulkActionBarProps {
  count: number
  isRunning: boolean
  canDelete: boolean
  canPublish: boolean
  bulkActions?: readonly ClientAction[]
  onExecuteAction?: (action: ClientAction) => void
  onDelete: () => void
  onPublish: () => void
  onUnpublish: () => void
  onClear: () => void
}

export function BulkActionBar(props: BulkActionBarProps) {
  const {
    count,
    isRunning,
    canDelete,
    canPublish,
    bulkActions,
    onExecuteAction,
    onDelete,
    onPublish,
    onUnpublish,
    onClear,
  } = props
  if (count === 0) return null
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="lt:mb-4 lt:flex lt:flex-wrap lt:items-center lt:gap-2.5 lt:rounded-md lt:border lt:bg-card lt:px-4 lt:py-2.5"
    >
      <span className="lt:mr-auto lt:text-sm lt:font-medium" data-testid="bulk-count">
        {count} selected
      </span>
      {canPublish && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRunning}
            onClick={onPublish}
          >
            Publish
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRunning}
            onClick={onUnpublish}
          >
            Unpublish
          </Button>
        </>
      )}
      {bulkActions?.map((action) => (
        <Button
          key={action.key}
          type="button"
          variant={action.variant ?? 'outline'}
          size="sm"
          disabled={isRunning}
          onClick={() => onExecuteAction?.(action)}
        >
          {action.label}
        </Button>
      ))}
      {canDelete && (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isRunning}
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" disabled={isRunning} onClick={onClear}>
        Clear selection
      </Button>
    </div>
  )
}

export interface BulkSummaryAlertProps {
  summary: BulkSummary | null
  labelFor: (id: RowId) => string
  onDismiss: () => void
}

export function BulkSummaryAlert({ summary, labelFor, onDismiss }: BulkSummaryAlertProps) {
  if (!summary) return null
  const { kind, succeeded, failed } = summary
  const done = plural(succeeded.length, 'document', 'documents')
  return (
    <Alert
      variant={failed.length > 0 ? 'destructive' : 'success'}
      className="lt:mb-5"
      data-testid="bulk-summary"
    >
      <div className="lt:flex lt:items-start lt:justify-between lt:gap-3">
        <div>
          <p className="lt:m-0">
            {VERB[kind]} {done}
            {failed.length > 0 ? `, ${failed.length} failed:` : '.'}
          </p>
          {failed.length > 0 && (
            <ul className="lt:mt-1.5 lt:mb-0 lt:pl-5">
              {failed.map((f) => (
                <li key={f.id}>
                  {labelFor(f.id)}: {f.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Alert>
  )
}
