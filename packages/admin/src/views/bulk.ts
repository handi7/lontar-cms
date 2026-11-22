import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteDoc, formatApiErrorMessage, publishDoc, unpublishDoc } from '../api/client'

export type RowId = number | string
export type BulkKind = 'delete' | 'publish' | 'unpublish'

export interface BulkFailure {
  id: RowId
  message: string
}

export interface BulkResult {
  succeeded: RowId[]
  failed: BulkFailure[]
}

export interface BulkSummary extends BulkResult {
  kind: BulkKind
}

export interface RowSelection {
  pageState: boolean | 'indeterminate'
  isSelected: (id: RowId) => boolean
  toggle: (id: RowId, checked: boolean) => void
  togglePage: (checked: boolean) => void
  labelFor: (id: RowId) => string
}

export const BULK_CONCURRENCY = 4

/**
 * Runs `worker` for every id with at most `concurrency` calls in flight. A failure never stops the
 * others, so one document the caller may not touch does not hide the rest.
 */
export async function runBulk(
  ids: RowId[],
  worker: (id: RowId) => Promise<unknown>,
  concurrency = BULK_CONCURRENCY,
): Promise<BulkResult> {
  const result: BulkResult = { succeeded: [], failed: [] }
  let next = 0
  const lane = async () => {
    while (next < ids.length) {
      const id = ids[next++] as RowId
      try {
        await worker(id)
        result.succeeded.push(id)
      } catch (err) {
        result.failed.push({ id, message: formatApiErrorMessage(err) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, lane))
  return result
}

/** Selected row ids. They reset whenever `resetKey` changes (page, search, filters, sort). */
export function useRowSelection(resetKey: string, pageIds: RowId[]) {
  const [selected, setSelected] = useState<Set<RowId>>(new Set())

  useEffect(() => {
    setSelected(new Set())
  }, [resetKey])

  // Only ids still on the page count, so a document removed elsewhere drops out of the total.
  const selectedIds = useMemo(() => pageIds.filter((id) => selected.has(id)), [pageIds, selected])

  const toggle = useCallback((id: RowId, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const togglePage = useCallback(
    (checked: boolean) => setSelected(checked ? new Set(pageIds) : new Set()),
    [pageIds],
  )

  const replace = useCallback((ids: RowId[]) => setSelected(new Set(ids)), [])

  let pageState: boolean | 'indeterminate' = false
  if (pageIds.length > 0 && selectedIds.length === pageIds.length) pageState = true
  else if (selectedIds.length > 0) pageState = 'indeterminate'

  return { selectedIds, pageState, toggle, togglePage, replace }
}

function bulkWorker(kind: BulkKind, apiBase: string, slug: string, locale?: string) {
  const options = locale ? { locale } : undefined
  return (id: RowId) => {
    if (kind === 'delete') return deleteDoc(apiBase, slug, id)
    if (kind === 'publish') return publishDoc(apiBase, slug, id, options)
    return unpublishDoc(apiBase, slug, id, options)
  }
}

/**
 * Calls the existing per-document endpoints, so access control, hooks and webhooks run exactly as
 * for a single document. The collection's queries are invalidated once, after the last call.
 */
export function useBulkActions(
  apiBase: string,
  slug: string,
  locale: string | undefined,
  resetKey: string,
  onFinished: (result: BulkResult) => void,
) {
  const queryClient = useQueryClient()
  const [summary, setSummary] = useState<BulkSummary | null>(null)

  // A summary describes the list as it was, so it goes when the list changes.
  useEffect(() => {
    setSummary(null)
  }, [resetKey])

  const mutation = useMutation({
    mutationFn: ({ kind, ids }: { kind: BulkKind; ids: RowId[] }) =>
      runBulk(ids, bulkWorker(kind, apiBase, slug, locale)),
    onSuccess: async (result, { kind }) => {
      setSummary({ kind, ...result })
      onFinished(result)
      await queryClient.invalidateQueries({ queryKey: [slug] })
    },
  })

  return {
    run: (kind: BulkKind, ids: RowId[]) => mutation.mutate({ kind, ids }),
    isRunning: mutation.isPending,
    summary,
    dismissSummary: () => setSummary(null),
  }
}
