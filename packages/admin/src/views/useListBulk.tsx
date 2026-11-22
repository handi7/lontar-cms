import { useMemo, useState, type ReactNode } from 'react'
import type { ClientCollection, CollectionPermission } from '@lontar/core/client'
import { BulkActionBar, BulkSummaryAlert } from './BulkActionBar'
import { useBulkActions, useRowSelection, type RowId, type RowSelection } from './bulk'
import { titleColumnKey } from './columns'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

export interface UseListBulkArgs {
  apiBase: string
  collection: ClientCollection
  docs: Array<Record<string, unknown>>
  /** Changes whenever the visible list does (page, search, filters, sort, locale). */
  resetKey: string
  locale: string | undefined
  permission: CollectionPermission | undefined
  canDelete: boolean
}

function docLabel(doc: Record<string, unknown> | undefined, titleKey: string, id: RowId): string {
  const title = doc?.[titleKey]
  return typeof title === 'string' && title.trim() ? title : `#${id}`
}

export function useListBulk(args: UseListBulkArgs): {
  selection: RowSelection | undefined
  controls: ReactNode
} {
  const { apiBase, collection, docs, resetKey, locale, permission, canDelete } = args
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const pageIds = useMemo(() => docs.map((d) => d.id as RowId), [docs])
  const rows = useRowSelection(resetKey, pageIds)
  const bulk = useBulkActions(apiBase, collection.slug, locale, resetKey, (result) =>
    // Failed documents stay selected so they can be retried.
    rows.replace(result.failed.map((f) => f.id)),
  )

  const titleKey = titleColumnKey(collection)
  const labelFor = (id: RowId) =>
    docLabel(
      docs.find((d) => d.id === id),
      titleKey,
      id,
    )

  // Publishing is an update as far as access control goes.
  const canPublish = Boolean(collection.versions?.drafts) && permission?.update !== false
  if (!canDelete && !canPublish) return { selection: undefined, controls: null }

  const selectedSet = new Set(rows.selectedIds)
  const selection: RowSelection = {
    pageState: rows.pageState,
    isSelected: (id) => selectedSet.has(id),
    toggle: rows.toggle,
    togglePage: rows.togglePage,
    labelFor,
  }

  const count = rows.selectedIds.length
  const controls = (
    <>
      <BulkActionBar
        count={count}
        isRunning={bulk.isRunning}
        canDelete={canDelete}
        canPublish={canPublish}
        onDelete={() => setConfirmingDelete(true)}
        onPublish={() => bulk.run('publish', rows.selectedIds)}
        onUnpublish={() => bulk.run('unpublish', rows.selectedIds)}
        onClear={() => rows.replace([])}
      />
      <BulkSummaryAlert
        summary={bulk.summary}
        labelFor={labelFor}
        onDismiss={bulk.dismissSummary}
      />
      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${count} ${count === 1 ? 'document' : 'documents'}`}
        description={`Are you sure you want to delete ${count === 1 ? 'this document' : `these ${count} documents`}? This cannot be undone.`}
        confirmLabel={`Delete ${count}`}
        onConfirm={() => {
          setConfirmingDelete(false)
          bulk.run('delete', rows.selectedIds)
        }}
      />
    </>
  )
  return { selection, controls }
}
