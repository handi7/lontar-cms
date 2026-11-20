import { useEffect, useRef } from 'react'

export interface UsePreviewPostMessageOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  enabled: boolean
  targetOrigin?: string
  collectionSlug: string
  values: Record<string, unknown>
  locale?: string
  debounceMs?: number
}

export function usePreviewPostMessage({
  iframeRef,
  enabled,
  targetOrigin,
  collectionSlug,
  values,
  locale,
  debounceMs = 150,
}: UsePreviewPostMessageOptions): { postImmediate: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestValuesRef = useRef(values)
  latestValuesRef.current = values
  const latestLocaleRef = useRef(locale)
  latestLocaleRef.current = locale

  const postImmediate = () => {
    if (!enabled || !targetOrigin || !iframeRef.current?.contentWindow) {
      return
    }
    const message = {
      source: 'lontar-preview',
      version: 1,
      collection: collectionSlug,
      document: latestValuesRef.current,
      ...(latestLocaleRef.current ? { locale: latestLocaleRef.current } : {}),
    }
    iframeRef.current.contentWindow.postMessage(message, targetOrigin)
  }

  useEffect(() => {
    if (!enabled || !targetOrigin) {
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      postImmediate()
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, targetOrigin, values, debounceMs])

  return { postImmediate }
}
