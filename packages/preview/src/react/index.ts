import { useEffect, useState } from 'react'
import { subscribeLivePreview } from '../index'

export interface UseLivePreviewOptions<T> {
  initialData: T
  serverURL: string
  collection?: string
  initialLocale?: string
}

export interface UseLivePreviewResult<T> {
  data: T
  isLive: boolean
  locale?: string
}

/**
 * React hook for real-time live preview.
 * Updates the document state when messages arrive from the Lontar admin preview iframe.
 * If running outside an iframe (normal visitor), returns initialData unchanged.
 */
export function useLivePreview<T>(options: UseLivePreviewOptions<T>): UseLivePreviewResult<T> {
  const [data, setData] = useState<T>(options.initialData)
  const [isLive, setIsLive] = useState(false)
  const [locale, setLocale] = useState<string | undefined>(options.initialLocale)

  useEffect(() => {
    if (!isLive) {
      setData(options.initialData)
    }
  }, [options.initialData, isLive])

  useEffect(() => {
    const unsubscribe = subscribeLivePreview<T>({
      initialData: options.initialData,
      serverURL: options.serverURL,
      collection: options.collection,
      onChange: (nextDoc, meta) => {
        setData(nextDoc)
        setIsLive(true)
        if (meta?.locale !== undefined) {
          setLocale(meta.locale)
        }
      },
    })

    return unsubscribe
  }, [options.serverURL, options.collection, options.initialData])

  return { data, isLive, locale }
}
