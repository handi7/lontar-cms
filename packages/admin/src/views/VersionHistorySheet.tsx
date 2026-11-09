import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { diffSnapshots, type ClientCollection, type ClientVersion } from '@lontar/core/client'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { History, Maximize2, Minimize2, RotateCcw } from 'lucide-react'
import { fetchDocVersions, restoreDocVersion, type ApiClientError } from '../api/client'
import { ConfirmRestoreDialog } from './ConfirmRestoreDialog'
import { VersionDiffViewer } from './VersionDiffViewer'
import { cn } from '../lib/utils'

export interface VersionHistorySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiBase: string
  collection: ClientCollection
  id: string | number
  currentDoc?: Record<string, unknown> | null
  onRestoreSuccess?: (restoredDoc: Record<string, unknown>) => void
}

function formatVersionDate(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

interface VersionListItemProps {
  version: ClientVersion
  isSelected: boolean
  isPublishedDoc: boolean
  isLatestDraft: boolean
  onSelect: () => void
}

function VersionListItem({
  version,
  isSelected,
  isPublishedDoc,
  isLatestDraft,
  onSelect,
}: VersionListItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'lt:w-full lt:text-left lt:p-3 lt:rounded-md lt:border lt:transition-colors lt:cursor-pointer lt:flex lt:flex-col lt:gap-1.5',
        isSelected
          ? 'lt:border-primary lt:bg-accent/40 lt:text-foreground'
          : 'lt:border-border lt:bg-card lt:hover:bg-accent/20 lt:text-muted-foreground',
      )}
    >
      <div className="lt:flex lt:items-center lt:justify-between lt:text-xs">
        <span className="lt:font-bold lt:text-foreground">v{version.versionNumber}</span>
        <span className="lt:text-[0.6875rem] lt:text-muted-foreground">
          {formatVersionDate(version.createdAt)}
        </span>
      </div>

      <div className="lt:flex lt:flex-wrap lt:items-center lt:gap-1.5">
        {isPublishedDoc && (
          <Badge
            variant="secondary"
            className="lt:border-success-border lt:bg-success-bg lt:text-success-text lt:text-[0.625rem] lt:px-1.5 lt:py-0"
          >
            Published
          </Badge>
        )}
        {isLatestDraft && (
          <Badge variant="secondary" className="lt:text-[0.625rem] lt:px-1.5 lt:py-0">
            Current Draft
          </Badge>
        )}
        {version.autosave && (
          <Badge
            variant="outline"
            className="lt:text-[0.625rem] lt:text-muted-foreground lt:px-1.5 lt:py-0"
          >
            Autosave
          </Badge>
        )}
      </div>

      {version.createdBy && (
        <span className="lt:text-[0.6875rem] lt:text-muted-foreground">by {version.createdBy}</span>
      )}
    </button>
  )
}

interface VersionListProps {
  versions: ClientVersion[]
  selectedVersionId: number | null
  currentDocPublishedVersionId: number | null
  latestDraftVersionId: number | null
  onSelectVersion: (id: number) => void
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

function VersionList({
  versions,
  selectedVersionId,
  currentDocPublishedVersionId,
  latestDraftVersionId,
  onSelectVersion,
  page,
  totalPages,
  onPageChange,
}: VersionListProps) {
  if (versions.length === 0) {
    return (
      <div className="lt:text-center lt:p-6 lt:text-xs lt:text-muted-foreground">
        No recorded versions for this document yet.
      </div>
    )
  }

  return (
    <div className="lt:flex lt:flex-col lt:gap-2.5 lt:h-full">
      <div className="lt:flex lt:flex-col lt:gap-2 lt:flex-1 lt:overflow-y-auto lt:pr-1">
        {versions.map((v) => (
          <VersionListItem
            key={v.id}
            version={v}
            isSelected={v.id === selectedVersionId}
            isPublishedDoc={v.id === currentDocPublishedVersionId}
            isLatestDraft={v.id === latestDraftVersionId}
            onSelect={() => onSelectVersion(v.id)}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="lt:flex lt:items-center lt:justify-between lt:pt-2 lt:border-t lt:border-border lt:text-xs">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="lt:text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

interface VersionDiffPanelProps {
  collection: ClientCollection
  selectedVersion: ClientVersion | undefined
  currentDoc: Record<string, unknown> | null | undefined
  onAskRestore: () => void
  isRestoring: boolean
}

function VersionDiffPanel({
  collection,
  selectedVersion,
  currentDoc,
  onAskRestore,
  isRestoring,
}: VersionDiffPanelProps) {
  if (!selectedVersion) {
    return (
      <div className="lt:flex lt:items-center lt:justify-center lt:h-full lt:text-xs lt:text-muted-foreground lt:p-8 lt:border lt:border-dashed lt:rounded-md">
        Select a version on the left to inspect and compare changes.
      </div>
    )
  }

  const diff = diffSnapshots(collection, selectedVersion.snapshot, currentDoc ?? {})

  return (
    <div className="lt:flex lt:flex-col lt:gap-3 lt:h-full lt:overflow-hidden">
      <div className="lt:flex lt:items-center lt:justify-between lt:border-b lt:border-border lt:pb-2.5 lt:shrink-0">
        <div className="lt:flex lt:flex-col lt:gap-0.5">
          <span className="lt:text-xs lt:font-semibold lt:text-foreground">
            Comparing v{selectedVersion.versionNumber} against Current State
          </span>
          <span className="lt:text-[0.6875rem] lt:text-muted-foreground">
            Recorded {formatVersionDate(selectedVersion.createdAt)}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          className="lt:gap-1.5"
          onClick={onAskRestore}
          disabled={isRestoring}
        >
          <RotateCcw className="lt:size-3.5" />
          <span>Restore v{selectedVersion.versionNumber}</span>
        </Button>
      </div>

      <div className="lt:flex-1 lt:overflow-y-auto lt:pr-1">
        <VersionDiffViewer
          diff={diff}
          fields={collection.fields}
          oldLabel={`v${selectedVersion.versionNumber} snapshot`}
          newLabel="Current Document"
        />
      </div>
    </div>
  )
}

interface UseVersionSelectionResult {
  selectedVersion: ClientVersion | undefined
  latestDraft: ClientVersion | undefined
  latestPublished: ClientVersion | undefined
}

function useVersionSelection(
  versions: ClientVersion[],
  selectedId: number | null,
): UseVersionSelectionResult {
  const selectedVersion = useMemo(() => {
    if (!selectedId && versions.length > 0) return versions[0]
    return versions.find((v) => v.id === selectedId) ?? versions[0]
  }, [versions, selectedId])

  const latestDraft = useMemo(() => versions.find((v) => v._status === 'draft'), [versions])
  const latestPublished = useMemo(() => versions.find((v) => v._status === 'published'), [versions])

  return { selectedVersion, latestDraft, latestPublished }
}

interface UseVersionRestoreOptions {
  apiBase: string
  slug: string
  id: string | number
  onSuccess: (doc: Record<string, unknown>) => void
}

function useVersionRestore({ apiBase, slug, id, onSuccess }: UseVersionRestoreOptions) {
  const queryClient = useQueryClient()
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (versionId: number) => restoreDocVersion(apiBase, slug, id, versionId),
    onSuccess: (restoredDoc) => {
      void queryClient.invalidateQueries({
        queryKey: ['document', apiBase, slug, String(id)],
      })
      void queryClient.invalidateQueries({
        queryKey: ['doc-versions', apiBase, slug, id],
      })
      onSuccess(restoredDoc)
    },
    onError: (err: ApiClientError) => {
      setRestoreError(err.message || 'Failed to restore version')
    },
  })

  return { mutation, restoreError, setRestoreError }
}

interface VersionHistoryHeaderProps {
  isExpanded: boolean
  onToggleExpand: () => void
}

function VersionHistoryHeader({ isExpanded, onToggleExpand }: VersionHistoryHeaderProps) {
  return (
    <SheetHeader className="lt:flex lt:flex-row lt:items-center lt:justify-between lt:pr-8">
      <div className="lt:flex lt:flex-col lt:gap-1">
        <SheetTitle className="lt:flex lt:items-center lt:gap-2">
          <History className="lt:size-4 lt:text-primary" />
          <span>Version History</span>
        </SheetTitle>
        <SheetDescription>
          Browse snapshots, compare changes with current form, and restore previous states.
        </SheetDescription>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="lt:h-8 lt:w-8 lt:p-0 lt:text-muted-foreground"
        aria-label={isExpanded ? 'Collapse width' : 'Expand width'}
        onClick={onToggleExpand}
      >
        {isExpanded ? <Minimize2 className="lt:size-4" /> : <Maximize2 className="lt:size-4" />}
      </Button>
    </SheetHeader>
  )
}

interface VersionHistoryContentProps {
  collection: ClientCollection
  versions: ClientVersion[]
  selectedVersion: ClientVersion | undefined
  latestPublished: ClientVersion | undefined
  latestDraft: ClientVersion | undefined
  onSelectVersion: (id: number) => void
  currentDoc: Record<string, unknown> | null | undefined
  onAskRestore: () => void
  isRestoring: boolean
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

function VersionHistoryContent(props: VersionHistoryContentProps) {
  return (
    <div className="lt:flex-1 lt:grid lt:grid-cols-1 md:lt:grid-cols-12 lt:gap-4 lt:min-h-0 lt:overflow-hidden">
      <div className="md:lt:col-span-5 lt:h-full lt:overflow-hidden">
        <VersionList
          versions={props.versions}
          selectedVersionId={props.selectedVersion?.id ?? null}
          currentDocPublishedVersionId={props.latestPublished?.id ?? null}
          latestDraftVersionId={props.latestDraft?.id ?? null}
          onSelectVersion={props.onSelectVersion}
          page={props.page}
          totalPages={props.totalPages}
          onPageChange={props.onPageChange}
        />
      </div>

      <div className="md:lt:col-span-7 lt:h-full lt:overflow-hidden lt:border-t md:lt:border-t-0 md:lt:border-l md:lt:pl-4 lt:border-border">
        <VersionDiffPanel
          collection={props.collection}
          selectedVersion={props.selectedVersion}
          currentDoc={props.currentDoc}
          onAskRestore={props.onAskRestore}
          isRestoring={props.isRestoring}
        />
      </div>
    </div>
  )
}

export function VersionHistorySheet({
  open,
  onOpenChange,
  apiBase,
  collection,
  id,
  currentDoc,
  onRestoreSuccess,
}: VersionHistorySheetProps) {
  const [page, setPage] = useState(1)
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false)

  const versionsQuery = useQuery({
    queryKey: ['doc-versions', apiBase, collection.slug, id, page],
    queryFn: () => fetchDocVersions(apiBase, collection.slug, id, { page, limit: 10 }),
    enabled: open && Boolean(id),
  })

  const versions = versionsQuery.data?.docs ?? []
  const { selectedVersion, latestDraft, latestPublished } = useVersionSelection(
    versions,
    selectedVersionId,
  )

  const {
    mutation: restoreMutation,
    restoreError,
    setRestoreError,
  } = useVersionRestore({
    apiBase,
    slug: collection.slug,
    id,
    onSuccess: (restoredDoc) => {
      setConfirmRestoreOpen(false)
      onOpenChange(false)
      onRestoreSuccess?.(restoredDoc)
    },
  })

  const handleConfirmRestore = () => {
    if (!selectedVersion) return
    setRestoreError(null)
    restoreMutation.mutate(selectedVersion.id)
  }

  return (
    <>
      <ConfirmRestoreDialog
        open={confirmRestoreOpen}
        onOpenChange={setConfirmRestoreOpen}
        onConfirm={handleConfirmRestore}
        versionNumber={selectedVersion?.versionNumber}
      />

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className={cn(
            'lt:flex lt:flex-col lt:gap-4',
            isExpanded ? 'lt:sm:max-w-4xl' : 'lt:sm:max-w-xl',
          )}
        >
          <VersionHistoryHeader
            isExpanded={isExpanded}
            onToggleExpand={() => setIsExpanded((prev) => !prev)}
          />

          {restoreError && (
            <div className="lt:rounded lt:border lt:border-destructive/30 lt:bg-error-bg lt:p-2 lt:text-xs lt:text-destructive">
              {restoreError}
            </div>
          )}

          <VersionHistoryContent
            collection={collection}
            versions={versions}
            selectedVersion={selectedVersion}
            latestPublished={latestPublished}
            latestDraft={latestDraft}
            onSelectVersion={(verId) => setSelectedVersionId(verId)}
            currentDoc={currentDoc}
            onAskRestore={() => setConfirmRestoreOpen(true)}
            isRestoring={restoreMutation.isPending}
            page={page}
            totalPages={versionsQuery.data?.totalPages ?? 1}
            onPageChange={setPage}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
