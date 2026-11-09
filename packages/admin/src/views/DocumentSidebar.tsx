import { ChevronDown, History } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { DocumentStatusBadge, getDocumentStatus, type DocumentStatus } from './DocumentStatusBadge'

export interface SidebarMetadataProps {
  doc: Record<string, unknown>
  showId: boolean
}

function SidebarMetadata({ doc, showId }: SidebarMetadataProps) {
  const hasId = showId && (typeof doc.id === 'string' || typeof doc.id === 'number')
  const hasCreatedAt = typeof doc.createdAt === 'string'
  const hasUpdatedAt = typeof doc.updatedAt === 'string'

  if (!hasId && !hasCreatedAt && !hasUpdatedAt) return null

  return (
    <div className="lt:border-t lt:border-border lt:pt-4 lt:flex lt:flex-col lt:gap-2 lt:text-xs lt:text-muted-foreground">
      {hasId && (
        <div className="lt:flex lt:items-center lt:justify-between">
          <span className="lt:font-medium lt:text-foreground">ID</span>
          <span>{String(doc.id)}</span>
        </div>
      )}
      {hasCreatedAt && (
        <div className="lt:flex lt:items-center lt:justify-between">
          <span className="lt:font-medium lt:text-foreground">Created</span>
          <span>{new Date(doc.createdAt as string).toLocaleString()}</span>
        </div>
      )}
      {hasUpdatedAt && (
        <div className="lt:flex lt:items-center lt:justify-between">
          <span className="lt:font-medium lt:text-foreground">Updated</span>
          <span>{new Date(doc.updatedAt as string).toLocaleString()}</span>
        </div>
      )}
    </div>
  )
}

export interface SidebarActionsProps {
  submitLabel: string
  isPending: boolean
  isDeleting?: boolean
  onDelete?: () => void
  canDelete: boolean
  hasDrafts?: boolean
  canUnpublish?: boolean
  hasVersions?: boolean
  onOpenHistory?: () => void
  onPublish?: () => void
  onSaveDraft?: () => void
  onUnpublish?: () => void
  isPublishing?: boolean
  isSavingDraft?: boolean
  isUnpublishing?: boolean
}

interface DraftPublishActionsProps {
  isBusy: boolean
  isPublishing?: boolean
  isSavingDraft?: boolean
  isUnpublishing?: boolean
  canUnpublish?: boolean
  onPublish?: () => void
  onSaveDraft?: () => void
  onUnpublish?: () => void
}

function DraftPublishActions(props: DraftPublishActionsProps) {
  const {
    isBusy,
    isPublishing,
    isSavingDraft,
    isUnpublishing,
    canUnpublish,
    onPublish,
    onSaveDraft,
    onUnpublish,
  } = props

  const publishLabel = isPublishing ? 'Publishing...' : 'Publish'
  const draftLabel = isSavingDraft ? 'Saving draft...' : 'Save draft'
  const unpublishLabel = isUnpublishing ? 'Unpublishing...' : 'Unpublish'

  return (
    <div className="lt:flex lt:w-full lt:items-center">
      <Button
        type={onPublish ? 'button' : 'submit'}
        onClick={onPublish}
        disabled={isBusy}
        className="lt:flex-1 lt:rounded-r-none"
      >
        {publishLabel}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            disabled={isBusy}
            className="lt:rounded-l-none lt:border-l lt:border-primary-foreground/20 lt:px-2"
            aria-label="Publishing options"
          >
            <ChevronDown className="lt:size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onSaveDraft} disabled={isBusy}>
            {draftLabel}
          </DropdownMenuItem>
          {canUnpublish && onUnpublish ? (
            <DropdownMenuItem
              onClick={onUnpublish}
              disabled={isBusy}
              className="lt:text-destructive lt:hover:text-destructive lt:focus:text-destructive"
            >
              {unpublishLabel}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function SidebarActions(props: SidebarActionsProps) {
  const isBusy = Boolean(
    props.isPending || props.isPublishing || props.isSavingDraft || props.isUnpublishing,
  )

  return (
    <div className="lt:flex lt:flex-col lt:gap-2">
      {!props.hasDrafts ? (
        <Button type="submit" disabled={props.isPending} className="lt:w-full">
          {props.submitLabel}
        </Button>
      ) : (
        <DraftPublishActions
          isBusy={isBusy}
          isPublishing={props.isPublishing}
          isSavingDraft={props.isSavingDraft}
          isUnpublishing={props.isUnpublishing}
          canUnpublish={props.canUnpublish}
          onPublish={props.onPublish}
          onSaveDraft={props.onSaveDraft}
          onUnpublish={props.onUnpublish}
        />
      )}

      {/* Slot: Live preview toggle (#204) */}
      {props.hasVersions && props.onOpenHistory ? (
        <Button
          type="button"
          variant="outline"
          className="lt:w-full lt:gap-1.5"
          disabled={isBusy}
          onClick={props.onOpenHistory}
        >
          <History className="lt:size-4" />
          <span>Version History</span>
        </Button>
      ) : null}

      {props.canDelete && props.onDelete ? (
        <Button
          type="button"
          variant="outline"
          className="lt:w-full lt:text-destructive lt:hover:border-destructive lt:hover:bg-error-bg lt:hover:text-destructive"
          disabled={Boolean(props.isDeleting || isBusy)}
          onClick={props.onDelete}
        >
          Delete
        </Button>
      ) : null}
    </div>
  )
}

function resolveCanUnpublish(
  mode: 'create' | 'edit',
  status: DocumentStatus,
  doc?: Record<string, unknown> | null,
): boolean {
  if (mode !== 'edit') return false
  if (status === 'published' || status === 'changed') return true
  return Boolean(doc?._isPublished || doc?._status === 'published')
}

export interface DocumentSidebarProps {
  mode?: 'create' | 'edit'
  submitLabel: string
  isPending: boolean
  isDeleting?: boolean
  onDelete?: () => void
  doc?: Record<string, unknown> | null
  showDelete?: boolean
  showId?: boolean
  hasDrafts?: boolean
  hasVersions?: boolean
  onOpenHistory?: () => void
  status?: DocumentStatus
  onPublish?: () => void
  onSaveDraft?: () => void
  onUnpublish?: () => void
  isPublishing?: boolean
  isSavingDraft?: boolean
  isUnpublishing?: boolean
}

export function DocumentSidebar(props: DocumentSidebarProps) {
  const mode = props.mode ?? 'edit'
  const resolvedStatus: DocumentStatus = props.status ?? getDocumentStatus(props.doc)
  const canUnpublish = resolveCanUnpublish(mode, resolvedStatus, props.doc)
  const canDelete = mode === 'edit' && Boolean(props.showDelete)
  const hasVersions = mode === 'edit' && Boolean(props.hasVersions)

  return (
    <aside
      aria-label="Document sidebar"
      className="lt:w-full lg:lt:w-[300px] lt:shrink-0 lt:order-first lg:lt:order-none lg:lt:sticky lg:lt:top-8 lt:flex lt:flex-col lt:gap-4"
    >
      <Card className="lt:p-5 lt:shadow-none lt:flex lt:flex-col lt:gap-4">
        {props.hasDrafts && (
          <div className="lt:flex lt:items-center lt:justify-between lt:text-xs">
            <span className="lt:font-medium lt:text-muted-foreground">Status</span>
            <DocumentStatusBadge status={resolvedStatus} />
          </div>
        )}

        {/* Slot: Autosave indicator (#203) */}

        <SidebarActions
          submitLabel={props.submitLabel}
          isPending={props.isPending}
          isDeleting={props.isDeleting}
          onDelete={props.onDelete}
          canDelete={canDelete}
          hasDrafts={props.hasDrafts}
          hasVersions={hasVersions}
          onOpenHistory={props.onOpenHistory}
          canUnpublish={canUnpublish}
          onPublish={props.onPublish}
          onSaveDraft={props.onSaveDraft}
          onUnpublish={props.onUnpublish}
          isPublishing={props.isPublishing}
          isSavingDraft={props.isSavingDraft}
          isUnpublishing={props.isUnpublishing}
        />

        {mode === 'edit' && props.doc && (
          <SidebarMetadata doc={props.doc} showId={props.showId ?? true} />
        )}
      </Card>
    </aside>
  )
}
