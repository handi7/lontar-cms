import { useState, useCallback, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { EditorPreviewToggle } from './EditorPreviewToggle'

export interface PreviewControl {
  isOpen: boolean
  toggle: () => void
  close: () => void
}

export function useEditorView(preview: PreviewControl) {
  const [activeView, setActiveView] = useState<'edit' | 'preview'>('edit')

  const toggle = useCallback(() => {
    setActiveView(preview.isOpen ? 'edit' : 'preview')
    preview.toggle()
  }, [preview])

  const close = useCallback(() => {
    setActiveView('edit')
    preview.close()
  }, [preview])

  return { activeView, setActiveView, toggle, close }
}

export interface EditorSplitLayoutProps {
  hasPreview: boolean
  isPreviewOpen: boolean
  activeView: 'edit' | 'preview'
  onViewChange: (view: 'edit' | 'preview') => void
  children: ReactNode
  preview: ReactNode
}

export function EditorSplitLayout(props: EditorSplitLayoutProps) {
  const { hasPreview, isPreviewOpen, activeView, onViewChange, children, preview } = props
  const showToggle = hasPreview && isPreviewOpen
  const formContainerClass = cn(
    'lt:@container lt:w-full lt:min-w-0',
    isPreviewOpen && 'lt:xl:w-1/2',
    isPreviewOpen && activeView === 'preview' && 'lt:hidden lt:xl:block',
  )

  return (
    <>
      {showToggle && <EditorPreviewToggle activeView={activeView} onChange={onViewChange} />}
      <div className="lt:flex lt:flex-col lt:xl:flex-row lt:gap-6 lt:w-full lt:items-start">
        <div className={formContainerClass}>{children}</div>
        {preview}
      </div>
    </>
  )
}
