import { Link } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { formatDimensions, formatFileSize, mediaName, mimeGroupOf } from './media'
import { MediaIcon } from './MediaIcon'

interface MediaDetailDialogProps {
  doc: Record<string, unknown> | null
  collectionSlug: string
  activeLocale?: string
  canDelete: boolean
  onDelete: (id: number | string) => void
  onClose: () => void
}

interface DetailRowProps {
  label: string
  children: React.ReactNode
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="lt:flex lt:gap-3">
      <dt className="lt:w-24 lt:shrink-0 lt:text-muted-foreground">{label}</dt>
      <dd className="lt:m-0 lt:min-w-0 lt:break-all">{children}</dd>
    </div>
  )
}

interface PreviewProps {
  doc: Record<string, unknown>
}

function Preview({ doc }: PreviewProps) {
  const url = typeof doc.url === 'string' ? doc.url : ''
  return (
    <div className="lt:flex lt:max-h-80 lt:items-center lt:justify-center lt:overflow-hidden lt:rounded-md lt:border lt:bg-muted">
      {mimeGroupOf(doc.mimeType) === 'images' && url ? (
        <img
          src={url}
          alt={mediaName(doc)}
          className="lt:max-h-80 lt:max-w-full lt:object-contain"
        />
      ) : (
        <MediaIcon
          mimeType={doc.mimeType}
          className="lt:my-10 lt:size-16 lt:text-muted-foreground"
        />
      )}
    </div>
  )
}

export function MediaDetailDialog({
  doc,
  collectionSlug,
  activeLocale,
  canDelete,
  onDelete,
  onClose,
}: MediaDetailDialogProps) {
  const url = typeof doc?.url === 'string' ? doc.url : ''
  const dimensions = doc ? formatDimensions(doc) : undefined
  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="lt:sm:max-w-xl">
        {doc && (
          <>
            <DialogHeader>
              <DialogTitle className="lt:break-all lt:pr-6">{mediaName(doc)}</DialogTitle>
              <DialogDescription>
                {typeof doc.mimeType === 'string' ? doc.mimeType : 'Unknown type'}
              </DialogDescription>
            </DialogHeader>
            <Preview doc={doc} />
            <dl className="lt:m-0 lt:grid lt:gap-1.5 lt:text-sm">
              <DetailRow label="Size">{formatFileSize(doc.filesize)}</DetailRow>
              {dimensions && <DetailRow label="Dimensions">{dimensions}</DetailRow>}
              {url && (
                <DetailRow label="URL">
                  <a href={url} target="_blank" rel="noreferrer" className="lt:underline">
                    {url}
                  </a>
                </DetailRow>
              )}
            </dl>
            <DialogFooter>
              {canDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    onClose()
                    onDelete(doc.id as number | string)
                  }}
                >
                  Delete
                </Button>
              )}
              <Button asChild>
                <Link
                  to="/$collection/$id"
                  params={{ collection: collectionSlug, id: String(doc.id) }}
                  search={(prev: Record<string, unknown>) =>
                    activeLocale ? { ...prev, locale: activeLocale } : prev
                  }
                >
                  Edit
                </Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
