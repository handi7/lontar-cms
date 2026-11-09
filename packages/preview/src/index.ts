/**
 * Protocol contract for messages sent between Lontar Admin and frontend preview iframe.
 * See ADR 0024.
 */
export interface LontarPreviewMessage<T = unknown> {
  source: 'lontar-preview'
  version: 1
  collection: string
  document: T
}

export interface SubscribeLivePreviewOptions<T> {
  initialData: T
  serverURL: string
  collection?: string
  onChange: (data: T) => void
}

/**
 * Subscribes to draft form messages streamed from the Lontar admin pane.
 * Only activates when running inside an iframe. Rejects messages with mismatched
 * origins, invalid versions, or different collection slugs.
 */
export function subscribeLivePreview<T>(options: SubscribeLivePreviewOptions<T>): () => void {
  if (typeof window === 'undefined' || window.self === window.top) {
    return () => {}
  }

  let expectedOrigin: string
  try {
    expectedOrigin = new URL(options.serverURL, window.location.href).origin
  } catch {
    return () => {}
  }

  const handleMessage = (event: MessageEvent<unknown>) => {
    if (event.origin !== expectedOrigin) {
      return
    }

    const data = event.data as Partial<LontarPreviewMessage<T>> | undefined
    if (
      !data ||
      typeof data !== 'object' ||
      data.source !== 'lontar-preview' ||
      data.version !== 1
    ) {
      return
    }

    if (options.collection && data.collection !== options.collection) {
      return
    }

    if (data.document !== undefined) {
      options.onChange(data.document)
    }
  }

  window.addEventListener('message', handleMessage)
  return () => {
    window.removeEventListener('message', handleMessage)
  }
}
