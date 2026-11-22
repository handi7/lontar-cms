import { formatFileSize, mediaName, thumbnailUrl } from './media'
import { MediaIcon } from './MediaIcon'
import { ListPagination } from './ListPagination'
import type { PaginatedDocs } from '../api/client'

interface MediaGridProps {
  docs: Array<Record<string, unknown>>
  data?: PaginatedDocs
  onOpen: (doc: Record<string, unknown>) => void
  onPageChange: (newPage: number) => void
}

interface MediaTileProps {
  doc: Record<string, unknown>
  onOpen: (doc: Record<string, unknown>) => void
}

function MediaTile({ doc, onOpen }: MediaTileProps) {
  const thumb = thumbnailUrl(doc)
  const name = mediaName(doc)
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(doc)}
        aria-label={`Open ${name}`}
        className="lt:flex lt:w-full lt:cursor-pointer lt:flex-col lt:overflow-hidden lt:rounded-md lt:border lt:bg-card lt:text-left lt:transition-colors lt:hover:bg-muted lt:focus-visible:outline-2 lt:focus-visible:outline-ring"
      >
        <span className="lt:flex lt:aspect-square lt:items-center lt:justify-center lt:bg-muted">
          {thumb ? (
            <img src={thumb} alt="" className="lt:size-full lt:object-cover" loading="lazy" />
          ) : (
            <MediaIcon mimeType={doc.mimeType} className="lt:size-10 lt:text-muted-foreground" />
          )}
        </span>
        <span className="lt:flex lt:flex-col lt:gap-0.5 lt:p-2.5">
          <span className="lt:truncate lt:text-[0.8125rem] lt:font-semibold">{name}</span>
          <span className="lt:text-xs lt:text-muted-foreground">
            {formatFileSize(doc.filesize)}
          </span>
        </span>
      </button>
    </li>
  )
}

export function MediaGrid({ docs, data, onOpen, onPageChange }: MediaGridProps) {
  return (
    <div className="lt:overflow-hidden lt:rounded-md lt:border lt:bg-card">
      <ul
        aria-label="Media"
        className="lt:m-0 lt:grid lt:list-none lt:grid-cols-2 lt:gap-3 lt:p-4 lt:sm:grid-cols-3 lt:lg:grid-cols-5"
      >
        {docs.map((doc) => (
          <MediaTile key={String(doc.id)} doc={doc} onOpen={onOpen} />
        ))}
      </ul>
      <ListPagination data={data} onPageChange={onPageChange} />
    </div>
  )
}
