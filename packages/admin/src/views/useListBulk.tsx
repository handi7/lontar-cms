import { useMemo, useState, type ReactNode } from 'react'
import type { ClientAction, ClientCollection, CollectionPermission } from '@lontar/core/client'
import { BulkActionBar, BulkSummaryAlert } from './BulkActionBar'
import {
  useBulkActions,
  useRowSelection,
  type BulkSummary,
  type RowId,
  type RowSelection,
} from './bulk'
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
  isActionPending?: boolean
  onExecuteAction?: (action: ClientAction, ids: RowId[], clearSelection: () => void) => void
}

function docLabel(doc: Record<string, unknown> | undefined, titleKey: string, id: RowId): string {
  const title = doc?.[titleKey]
  return typeof title === 'string' && title.trim() ? title : `#${id}`
}

function resolveAvailableBulkActions(
  actions: readonly ClientAction[] | undefined,
  actionsPerm: Record<string, boolean> | undefined,
): ClientAction[] {
  if (!actions) return []
  return actions.filter(
    (action) => action.scope.includes('bulk') && actionsPerm?.[action.key] !== false,
  )
}

function resolveDeleteDialogTexts(count: number) {
  const isSingle = count === 1
  return {
    title: `Delete ${count} ${isSingle ? 'document' : 'documents'}`,
    description: `Are you sure you want to delete ${isSingle ? 'this document' : `these ${count} documents`}? This cannot be undone.`,
    confirmLabel: `Delete ${count}`,
  }
}

interface ListBulkControlsProps {
  count: number
  isRunning: boolean
  canDelete: boolean
  canPublish: boolean
  bulkActions: ClientAction[]
  onExecuteAction?: (action: ClientAction, ids: RowId[], clearSelection: () => void) => void
  onDeleteClick: () => void
  onPublish: () => void
  onUnpublish: () => void
  onClear: () => void
  summary: BulkSummary | null
  labelFor: (id: RowId) => string
  onDismissSummary: () => void
  confirmingDelete: boolean
  onOpenChangeConfirm: (open: boolean) => void
  onConfirmDelete: () => void
  selectedIds: RowId[]
  clearSelection: () => void
}

function ListBulkControls(props: ListBulkControlsProps) {
  const {
    count,
    isRunning,
    canDelete,
    canPublish,
    bulkActions,
    onExecuteAction,
    onDeleteClick,
    onPublish,
    onUnpublish,
    onClear,
    summary,
    labelFor,
    onDismissSummary,
    confirmingDelete,
    onOpenChangeConfirm,
    onConfirmDelete,
    selectedIds,
    clearSelection,
  } = props

  const { title, description, confirmLabel } = resolveDeleteDialogTexts(count)

  return (
    <>
      <BulkActionBar
        count={count}
        isRunning={isRunning}
        canDelete={canDelete}
        canPublish={canPublish}
        bulkActions={bulkActions}
        onExecuteAction={(action) => onExecuteAction?.(action, selectedIds, clearSelection)}
        onDelete={onDeleteClick}
        onPublish={onPublish}
        onUnpublish={onUnpublish}
        onClear={onClear}
      />
      <BulkSummaryAlert summary={summary} labelFor={labelFor} onDismiss={onDismissSummary} />
      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={onOpenChangeConfirm}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        onConfirm={onConfirmDelete}
      />
    </>
  )
}

function canShowRowSelection(
  canDelete: boolean,
  hasDrafts: boolean,
  hasUpdatePermission: boolean,
  bulkActionsCount: number,
): { canPublish: boolean; hasActions: boolean } {
  const canPublish = hasDrafts && hasUpdatePermission
  const hasActions = canDelete || canPublish || bulkActionsCount > 0
  return { canPublish, hasActions }
}

export function useListBulk(args: UseListBulkArgs): {
  selection: RowSelection | undefined
  controls: ReactNode
} {
  const {
    apiBase,
    collection,
    docs,
    resetKey,
    locale,
    permission,
    canDelete,
    isActionPending,
    onExecuteAction,
  } = args
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

  const availableBulkActions = useMemo(
    () => resolveAvailableBulkActions(collection.admin?.actions, permission?.actions),
    [collection.admin?.actions, permission?.actions],
  )

  const hasDrafts = Boolean(collection.versions?.drafts)
  const hasUpdatePermission = permission?.update !== false
  const { canPublish, hasActions } = canShowRowSelection(
    canDelete,
    hasDrafts,
    hasUpdatePermission,
    availableBulkActions.length,
  )
  if (!hasActions) return { selection: undefined, controls: null }

  const selectedSet = new Set(rows.selectedIds)
  const selection: RowSelection = {
    pageState: rows.pageState,
    isSelected: (id) => selectedSet.has(id),
    toggle: rows.toggle,
    togglePage: rows.togglePage,
    labelFor,
  }

  const isRunning = bulk.isRunning || Boolean(isActionPending)
  const clearSelection = () => rows.replace([])
  const onConfirmDelete = () => {
    setConfirmingDelete(false)
    bulk.run('delete', rows.selectedIds)
  }

  const controls = (
    <ListBulkControls
      count={rows.selectedIds.length}
      isRunning={isRunning}
      canDelete={canDelete}
      canPublish={canPublish}
      bulkActions={availableBulkActions}
      onExecuteAction={onExecuteAction}
      onDeleteClick={() => setConfirmingDelete(true)}
      onPublish={() => bulk.run('publish', rows.selectedIds)}
      onUnpublish={() => bulk.run('unpublish', rows.selectedIds)}
      onClear={clearSelection}
      summary={bulk.summary}
      labelFor={labelFor}
      onDismissSummary={bulk.dismissSummary}
      confirmingDelete={confirmingDelete}
      onOpenChangeConfirm={setConfirmingDelete}
      onConfirmDelete={onConfirmDelete}
      selectedIds={rows.selectedIds}
      clearSelection={clearSelection}
    />
  )
  return { selection, controls }
}
