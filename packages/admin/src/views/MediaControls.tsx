import { LayoutGrid, List } from 'lucide-react'
import { Button } from '../components/ui/button'
import { MIME_GROUPS, type ListViewMode, type MimeGroup } from './media'

interface MediaControlsProps {
  mimeGroup: MimeGroup | undefined
  onMimeGroupChange: (group: MimeGroup | undefined) => void
  viewMode: ListViewMode
  onViewModeChange: (mode: ListViewMode) => void
}

/** Type filter and table/grid switch, shown above the list of an upload collection. */
export function MediaControls({
  mimeGroup,
  onMimeGroupChange,
  viewMode,
  onViewModeChange,
}: MediaControlsProps) {
  return (
    <div className="lt:mb-4 lt:flex lt:flex-wrap lt:items-center lt:justify-between lt:gap-3">
      <div role="group" aria-label="File type" className="lt:flex lt:flex-wrap lt:gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={mimeGroup === undefined ? 'default' : 'outline'}
          aria-pressed={mimeGroup === undefined}
          onClick={() => onMimeGroupChange(undefined)}
        >
          All types
        </Button>
        {MIME_GROUPS.map((group) => (
          <Button
            key={group.value}
            type="button"
            size="sm"
            variant={mimeGroup === group.value ? 'default' : 'outline'}
            aria-pressed={mimeGroup === group.value}
            onClick={() => onMimeGroupChange(group.value)}
          >
            {group.label}
          </Button>
        ))}
      </div>
      <div role="group" aria-label="View" className="lt:flex lt:gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={viewMode === 'table' ? 'default' : 'outline'}
          aria-pressed={viewMode === 'table'}
          onClick={() => onViewModeChange('table')}
        >
          <List className="lt:size-4" aria-hidden="true" />
          Table
        </Button>
        <Button
          type="button"
          size="sm"
          variant={viewMode === 'grid' ? 'default' : 'outline'}
          aria-pressed={viewMode === 'grid'}
          onClick={() => onViewModeChange('grid')}
        >
          <LayoutGrid className="lt:size-4" aria-hidden="true" />
          Grid
        </Button>
      </div>
    </div>
  )
}
