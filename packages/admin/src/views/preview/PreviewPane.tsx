import { useState, useRef, useEffect } from 'react'
import { AlertCircle, ExternalLink, Monitor, RotateCw, Smartphone, Tablet, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { cn } from '../../lib/utils'
import { resolvePreviewUrl } from './url'
import { usePreviewPostMessage } from './usePreviewPostMessage'

export type PreviewPreset = 'desktop' | 'tablet' | 'mobile'

export interface PreviewPaneProps {
  collectionSlug: string
  urlTemplate: string
  values: Record<string, unknown>
  savedValues?: Record<string, unknown> | null
  onClose: () => void
  className?: string
}

interface PreviewHeaderProps {
  preset: PreviewPreset
  onSelectPreset: (preset: PreviewPreset) => void
  onReload: () => void
  onClose: () => void
  url?: string
}

function PreviewHeader({ preset, onSelectPreset, onReload, onClose, url }: PreviewHeaderProps) {
  return (
    <div className="lt:flex lt:items-center lt:justify-between lt:border-b lt:border-border lt:bg-card lt:px-3 lt:py-2 lt:text-xs">
      <div className="lt:flex lt:items-center lt:gap-1">
        <Button
          type="button"
          size="sm"
          variant={preset === 'desktop' ? 'secondary' : 'ghost'}
          className="lt:h-7 lt:px-2 lt:gap-1.5"
          onClick={() => onSelectPreset('desktop')}
          title="Desktop view (100%)"
        >
          <Monitor className="lt:size-3.5" />
          <span className="lt:hidden lt:sm:inline">Desktop</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant={preset === 'tablet' ? 'secondary' : 'ghost'}
          className="lt:h-7 lt:px-2 lt:gap-1.5"
          onClick={() => onSelectPreset('tablet')}
          title="Tablet view (768px)"
        >
          <Tablet className="lt:size-3.5" />
          <span className="lt:hidden lt:sm:inline">Tablet</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant={preset === 'mobile' ? 'secondary' : 'ghost'}
          className="lt:h-7 lt:px-2 lt:gap-1.5"
          onClick={() => onSelectPreset('mobile')}
          title="Mobile view (375px)"
        >
          <Smartphone className="lt:size-3.5" />
          <span className="lt:hidden lt:sm:inline">Mobile</span>
        </Button>
      </div>

      <div className="lt:flex lt:items-center lt:gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="lt:h-7 lt:w-7 lt:p-0"
          onClick={onReload}
          title="Reload preview"
        >
          <RotateCw className="lt:size-3.5" />
        </Button>
        {url && (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="lt:h-7 lt:w-7 lt:p-0"
            title="Open in new tab"
          >
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="lt:size-3.5" />
            </a>
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="lt:h-7 lt:w-7 lt:p-0 lt:text-muted-foreground lt:hover:text-foreground"
          onClick={onClose}
          title="Close preview"
        >
          <X className="lt:size-4" />
        </Button>
      </div>
    </div>
  )
}

function resolvePresetWidthClass(preset: PreviewPreset): string {
  if (preset === 'mobile') {
    return 'lt:w-[375px] lt:h-full lt:shadow-md lt:border lt:border-border lt:rounded-lg lt:overflow-hidden'
  }
  if (preset === 'tablet') {
    return 'lt:w-[768px] lt:h-full lt:shadow-md lt:border lt:border-border lt:rounded-lg lt:overflow-hidden'
  }
  return 'lt:w-full lt:h-full'
}

interface PendingPlaceholderProps {
  missingTokens: string[]
  isUnsaved?: boolean
}

function PendingPlaceholder({ missingTokens, isUnsaved }: PendingPlaceholderProps) {
  const tokenList = missingTokens.map((t) => `"${t}"`).join(', ')
  return (
    <div className="lt:flex lt:flex-col lt:items-center lt:justify-center lt:h-full lt:p-8 lt:text-center lt:text-muted-foreground lt:text-xs">
      <AlertCircle className="lt:size-8 lt:mb-2 lt:text-muted-foreground/60" />
      <p className="lt:font-medium lt:text-foreground lt:text-sm">Preview pending</p>
      <p className="lt:mt-1 lt:max-w-xs">
        {isUnsaved ? 'Save to start live preview.' : `Fill in ${tokenList} to start live preview.`}
      </p>
    </div>
  )
}

const PRESET_STORAGE_KEY = 'lontar:preview:preset'

export function PreviewPane(props: PreviewPaneProps) {
  const [preset, setPreset] = useState<PreviewPreset>(() => {
    try {
      const stored = localStorage.getItem(PRESET_STORAGE_KEY)
      if (stored === 'mobile' || stored === 'tablet' || stored === 'desktop') {
        return stored
      }
    } catch {
      // Ignore localStorage errors
    }
    return 'desktop'
  })

  const [reloadKey, setReloadKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const handleSelectPreset = (nextPreset: PreviewPreset) => {
    setPreset(nextPreset)
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, nextPreset)
    } catch {
      // Ignore localStorage errors
    }
  }

  const resolved = resolvePreviewUrl(props.urlTemplate, props.savedValues ?? {})

  const isUnsaved =
    resolved.missingTokens.length > 0 &&
    resolved.missingTokens.every((token) => {
      const val = props.values[token]
      return val !== undefined && val !== null && (typeof val !== 'string' || val.trim() !== '')
    })

  const { postImmediate } = usePreviewPostMessage({
    iframeRef,
    enabled: resolved.ready,
    targetOrigin: resolved.origin,
    collectionSlug: props.collectionSlug,
    values: props.values,
  })

  useEffect(() => {
    if (resolved.ready) {
      postImmediate()
    }
  }, [reloadKey, resolved.ready])

  const presetClass = resolvePresetWidthClass(preset)

  return (
    <Card
      aria-label="Live preview pane"
      className={cn(
        'lt:flex lt:flex-col lt:h-full lt:overflow-hidden lt:border lt:border-border lt:bg-card lt:shadow-sm',
        props.className,
      )}
    >
      <PreviewHeader
        preset={preset}
        onSelectPreset={handleSelectPreset}
        onReload={() => setReloadKey((k) => k + 1)}
        onClose={props.onClose}
        url={resolved.url}
      />

      <div className="lt:flex-1 lt:h-full lt:overflow-auto lt:bg-muted/30 lt:p-2 lt:flex lt:justify-center lt:items-stretch">
        {!resolved.ready ? (
          <PendingPlaceholder missingTokens={resolved.missingTokens} isUnsaved={isUnsaved} />
        ) : (
          <div className={cn('lt:transition-all lt:duration-200 lt:bg-background', presetClass)}>
            <iframe
              key={reloadKey}
              ref={iframeRef}
              src={resolved.url}
              title="Live Preview"
              onLoad={postImmediate}
              className="lt:w-full lt:h-full lt:border-0 lt:bg-background"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        )}
      </div>
    </Card>
  )
}
