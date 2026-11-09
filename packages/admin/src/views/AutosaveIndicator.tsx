import { useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { Alert } from '../components/ui/alert'
import { cn } from '../lib/utils'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface AutosaveIndicatorProps {
  status: AutosaveStatus
  lastSavedAt?: Date | null
  consecutiveErrors?: number
  className?: string
}

function formatRelativeTime(date: Date, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - date.getTime()) / 1000))
  if (diffSec < 5) return 'Saved just now'
  if (diffSec < 60) return `Saved ${diffSec}s ago`
  if (diffSec < 3600) return `Saved ${Math.floor(diffSec / 60)}m ago`

  try {
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `Saved at ${timeStr}`
  } catch {
    return 'Saved'
  }
}

export function AutosaveIndicator(props: AutosaveIndicatorProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (props.status !== 'saved' || !props.lastSavedAt) return
    setNow(Date.now())
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 5000)
    return () => clearInterval(interval)
  }, [props.status, props.lastSavedAt])

  if (props.status === 'idle') return null

  if (props.status === 'saving') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'lt:flex lt:items-center lt:gap-1.5 lt:text-xs lt:text-muted-foreground',
          props.className,
        )}
      >
        <Loader2 className="lt:size-3.5 lt:animate-[lontar-spin_1s_linear_infinite]" />
        <span>Saving…</span>
      </div>
    )
  }

  if (props.status === 'saved') {
    const text = props.lastSavedAt ? formatRelativeTime(props.lastSavedAt, now) : 'Saved'
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'lt:flex lt:items-center lt:gap-1.5 lt:text-xs lt:text-muted-foreground',
          props.className,
        )}
      >
        <Check className="lt:size-3.5 lt:text-success-text" />
        <span>{text}</span>
      </div>
    )
  }

  const consecutive = props.consecutiveErrors ?? 1
  return (
    <div className={cn('lt:flex lt:flex-col lt:gap-2', props.className)}>
      <div
        role="alert"
        className="lt:flex lt:items-center lt:gap-1.5 lt:text-xs lt:text-destructive"
      >
        <AlertCircle className="lt:size-3.5" />
        <span>Couldn't save, retrying…</span>
      </div>
      {consecutive >= 3 && (
        <Alert variant="destructive" className="lt:text-xs lt:py-2 lt:px-3">
          Autosave failed. Your changes are preserved locally in this form.
        </Alert>
      )}
    </div>
  )
}
