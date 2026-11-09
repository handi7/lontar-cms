import { useEffect, useState } from 'react'
import { subscribeLivePreview } from '../index'

export interface UseLivePreviewOptions<T> {
  initialData: T
  serverURL: string
  collection?: string
}

export interface UseLivePreviewResult<T> {
  data: T
  isLive: boolean
}

/**
 * React hook for real-time live preview.
 * Updates the document state when messages arrive from the Lontar admin preview iframe.
 * If running outside an iframe (normal visitor), returns initialData unchanged.
 */
export function useLivePreview<T>(options: UseLivePreviewOptions<T>): UseLivePreviewResult<T> {
  const [data, setData] = useState<T>(options.initialData)
  const [isLive, setIsLive] = useState(false)

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
      onChange: (nextDoc) => {
        setData(nextDoc)
        setIsLive(true)
      },
    })

    return unsubscribe
  }, [options.serverURL, options.collection, options.initialData])

  return { data, isLive }
}
