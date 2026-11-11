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

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function getEntityId(val: unknown): string | number | undefined {
  if (!isObject(val)) return undefined
  if (typeof val.id === 'string' || typeof val.id === 'number') {
    return val.id
  }
  if (typeof val._id === 'string' || typeof val._id === 'number') {
    return val._id
  }
  return undefined
}

function isSameId(a: unknown, b: unknown): boolean {
  if (
    (typeof a !== 'string' && typeof a !== 'number') ||
    (typeof b !== 'string' && typeof b !== 'number')
  ) {
    return false
  }
  return String(a) === String(b)
}

function matchPopulatedEntity(initial: unknown, incoming: unknown): unknown {
  if (isObject(initial)) {
    const initialId = getEntityId(initial)
    if (initialId !== undefined && isSameId(initialId, incoming)) {
      return initial
    }
  }
  return undefined
}

function findPopulatedInArray(initialArr: unknown[], incomingId: unknown): unknown {
  for (const item of initialArr) {
    if (isSameId(getEntityId(item), incomingId)) {
      return item
    }
  }
  return undefined
}

function mergeArrays(initialArr: unknown[] | undefined, incomingArr: unknown[]): unknown[] {
  if (!initialArr || !Array.isArray(initialArr)) {
    return incomingArr.map((item) => mergeValue(undefined, item, false))
  }

  return incomingArr.map((incItem) => {
    if (incItem !== null && typeof incItem !== 'object') {
      const populated = findPopulatedInArray(initialArr, incItem)
      if (populated !== undefined) {
        return populated
      }
      return incItem
    }

    const incId = getEntityId(incItem)
    if (incId !== undefined) {
      const matchingInitial = findPopulatedInArray(initialArr, incId)
      if (matchingInitial !== undefined) {
        return mergeValue(matchingInitial, incItem, false)
      }
    }

    return mergeValue(undefined, incItem, false)
  })
}

function mergePrimitive(initial: unknown, incoming: unknown): unknown {
  const populated = matchPopulatedEntity(initial, incoming)
  if (populated !== undefined) {
    return populated
  }
  return incoming
}

function mergeObject(
  initial: unknown,
  incoming: Record<string, unknown>,
  isTopLevel: boolean,
): Record<string, unknown> {
  const initialObj = isObject(initial) ? initial : undefined
  const result: Record<string, unknown> = isTopLevel && initialObj ? { ...initialObj } : {}

  for (const key of Object.keys(incoming)) {
    result[key] = mergeValue(initialObj?.[key], incoming[key], false)
  }

  return result
}

function mergeValue(initial: unknown, incoming: unknown, isTopLevel: boolean): unknown {
  if (incoming === undefined) {
    return initial
  }

  if (incoming === null || typeof incoming !== 'object') {
    return mergePrimitive(initial, incoming)
  }

  if (Array.isArray(incoming)) {
    const initialArr = Array.isArray(initial) ? initial : undefined
    return mergeArrays(initialArr, incoming)
  }

  if (!isObject(incoming)) {
    return incoming
  }

  return mergeObject(initial, incoming, isTopLevel)
}

/**
 * Merges incoming preview form data over existing data.
 * When an incoming field contains an ID referencing an already-populated entity object
 * (or array of IDs matching populated entity objects in initialData), the populated
 * object is preserved.
 */
export function mergeLivePreviewData<T>(initial: T, incoming: unknown): T {
  return mergeValue(initial, incoming, true) as T
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
      const merged: T = mergeLivePreviewData(options.initialData, data.document)
      options.onChange(merged)
    }
  }

  window.addEventListener('message', handleMessage)
  return () => {
    window.removeEventListener('message', handleMessage)
  }
}
