import { cn } from '../../lib/utils'

export interface EditorPreviewToggleProps {
  activeView: 'edit' | 'preview'
  onChange: (view: 'edit' | 'preview') => void
  className?: string
}

export function EditorPreviewToggle(props: EditorPreviewToggleProps) {
  const { activeView, onChange, className } = props

  return (
    <div
      role="tablist"
      aria-label="Editor view"
      className={cn(
        'lt:inline-flex lt:items-center lt:gap-1 lt:rounded-lg lt:border lt:border-border lt:bg-muted lt:p-1 lt:mb-6 lt:xl:hidden',
        className,
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeView === 'edit'}
        onClick={() => onChange('edit')}
        className={cn(
          'lt:px-3 lt:py-1.5 lt:text-xs lt:font-medium lt:rounded-md lt:transition-colors lt:cursor-pointer',
          activeView === 'edit'
            ? 'lt:bg-card lt:text-foreground lt:shadow-xs'
            : 'lt:text-muted-foreground lt:hover:text-foreground',
        )}
      >
        Edit
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeView === 'preview'}
        onClick={() => onChange('preview')}
        className={cn(
          'lt:px-3 lt:py-1.5 lt:text-xs lt:font-medium lt:rounded-md lt:transition-colors lt:cursor-pointer',
          activeView === 'preview'
            ? 'lt:bg-card lt:text-foreground lt:shadow-xs'
            : 'lt:text-muted-foreground lt:hover:text-foreground',
        )}
      >
        Preview
      </button>
    </div>
  )
}
