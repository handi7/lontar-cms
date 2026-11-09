import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'

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
  isDeleting: boolean
  onDelete?: () => void
  canDelete: boolean
}

function SidebarActions({
  submitLabel,
  isPending,
  isDeleting,
  onDelete,
  canDelete,
}: SidebarActionsProps) {
  return (
    <div className="lt:flex lt:flex-col lt:gap-2">
      <Button type="submit" disabled={isPending} className="lt:w-full">
        {submitLabel}
      </Button>

      {/* Slot: Save Draft / Publish / Unpublish actions (#201) */}
      {/* Slot: Live preview toggle (#204) */}
      {/* Slot: Version history entry point (#202) */}

      {canDelete && onDelete && (
        <Button
          type="button"
          variant="outline"
          className="lt:w-full lt:text-destructive lt:hover:border-destructive lt:hover:bg-error-bg lt:hover:text-destructive"
          disabled={isDeleting}
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
    </div>
  )
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
}

export function DocumentSidebar({
  mode = 'edit',
  submitLabel,
  isPending,
  isDeleting = false,
  onDelete,
  doc,
  showDelete = false,
  showId = true,
}: DocumentSidebarProps) {
  const canDelete = mode === 'edit' && showDelete

  return (
    <aside
      aria-label="Document sidebar"
      className="lt:w-full lg:lt:w-[300px] lt:shrink-0 lt:order-first lg:lt:order-none lg:lt:sticky lg:lt:top-8 lt:flex lt:flex-col lt:gap-4"
    >
      <Card className="lt:p-5 lt:shadow-none lt:flex lt:flex-col lt:gap-4">
        {/* Slot: Document status badge & publish state (#201) */}
        {/* Slot: Autosave indicator (#203) */}

        <SidebarActions
          submitLabel={submitLabel}
          isPending={isPending}
          isDeleting={isDeleting}
          onDelete={onDelete}
          canDelete={canDelete}
        />

        {mode === 'edit' && doc && <SidebarMetadata doc={doc} showId={showId} />}
      </Card>
    </aside>
  )
}
