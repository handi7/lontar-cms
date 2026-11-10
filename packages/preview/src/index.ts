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

function mergeArrayItem(initialArr: unknown[], incItem: unknown, index: number): unknown {
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
      return mergeLivePreviewData(matchingInitial, incItem)
    }
  }

  if (index < initialArr.length) {
    return mergeLivePreviewData(initialArr[index], incItem)
  }

  return incItem
}

function mergeArrays(initialArr: unknown[], incomingArr: unknown[]): unknown[] {
  return incomingArr.map((item, idx) => mergeArrayItem(initialArr, item, idx))
}

function mergeObjects(
  initialObj: Record<string, unknown>,
  incomingObj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...initialObj }
  for (const key of Object.keys(incomingObj)) {
    result[key] = mergeLivePreviewData(initialObj[key], incomingObj[key])
  }
  return result
}

/**
 * Merges incoming preview form data over existing data.
 * When an incoming field contains an ID referencing an already-populated entity object
 * (or array of IDs matching populated entity objects in initialData), the populated
 * object is preserved.
 */
export function mergeLivePreviewData<T>(initial: T, incoming: unknown): T {
  if (incoming === undefined) {
    return initial
  }

  if (incoming === null || typeof incoming !== 'object') {
    const populated = matchPopulatedEntity(initial, incoming)
    if (populated !== undefined) {
      return populated as T
    }
    return incoming as T
  }

  if (Array.isArray(incoming)) {
    if (!Array.isArray(initial)) {
      return incoming as T
    }
    return mergeArrays(initial, incoming) as T
  }

  if (!isObject(initial) || !isObject(incoming)) {
    return incoming as T
  }

  return mergeObjects(initial, incoming) as T
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

  let currentData: unknown = options.initialData

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
      const merged = mergeLivePreviewData(currentData, data.document) as T
      currentData = merged
      options.onChange(merged)
    }
  }

  window.addEventListener('message', handleMessage)
  return () => {
    window.removeEventListener('message', handleMessage)
  }
}
