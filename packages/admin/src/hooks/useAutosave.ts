import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutosaveStatus } from '../views/AutosaveIndicator'
import { ApiClientError, formatApiErrorMessage } from '../api/client'

const DEFAULT_MAX_RETRIES = 3
const MAX_BACKOFF_DELAY = 30_000

export interface UseAutosaveOptions {
  enabled: boolean
  interval: number
  isDirty: boolean
  isValid: boolean
  values?: unknown
  maxRetries?: number
  onSave: () => Promise<Record<string, unknown>>
  onSuccess?: (savedDoc: Record<string, unknown>) => void
}

export interface UseAutosaveReturn {
  status: AutosaveStatus
  lastSavedAt: Date | null
  errorMessage: string | null
  consecutiveErrors: number
  cancelAutosave: () => Promise<void>
  flush: () => Promise<void>
}

function serializeValues(val: unknown): string {
  if (val === undefined) return ''
  try {
    return JSON.stringify(val) ?? ''
  } catch {
    return ''
  }
}

interface SaveStateContext {
  setStatus: (s: AutosaveStatus) => void
  setLastSavedAt: (d: Date) => void
  setErrorMessage: (msg: string | null) => void
  setConsecutiveErrors: (updater: (prev: number) => number) => void
  lastSavedValuesRef: React.MutableRefObject<string | null>
}

function handleSaveSuccess(
  savedDoc: Record<string, unknown>,
  savedValuesSerialized: string | null,
  onSuccess: ((savedDoc: Record<string, unknown>) => void) | undefined,
  isMounted: boolean,
  ctx: SaveStateContext,
): void {
  if (isMounted) {
    ctx.setStatus('saved')
    ctx.setLastSavedAt(new Date())
    ctx.setErrorMessage(null)
    ctx.setConsecutiveErrors(() => 0)
  }
  if (savedValuesSerialized !== null) {
    ctx.lastSavedValuesRef.current = savedValuesSerialized
  }
  onSuccess?.(savedDoc)
}

function handleSaveFailure(err: unknown, ctx: SaveStateContext): void {
  ctx.setStatus('error')
  ctx.setErrorMessage(formatApiErrorMessage(err))
  ctx.setConsecutiveErrors((prev) => prev + 1)
}

function getErrorStatus(err: unknown): number | null {
  if (err instanceof ApiClientError) {
    return err.status
  }
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = err.status
    if (typeof s === 'number') return s
  }
  return null
}

function is4xxError(err: unknown): boolean {
  const status = getErrorStatus(err)
  return status !== null && status >= 400 && status < 500
}

function calculateRetryDelay(
  err: unknown,
  attempt: number,
  interval: number,
  maxRetries: number,
): number | null {
  if (is4xxError(err) || attempt > maxRetries) {
    return null
  }
  const delay = interval * Math.pow(2, attempt - 1)
  return Math.min(delay, MAX_BACKOFF_DELAY)
}

function shouldSkipSave(
  state: { enabled: boolean; isDirty: boolean; isValid: boolean; values?: unknown },
  serializedAtStart: string | null,
  lastSaved: string | null,
): boolean {
  if (!state.enabled || !state.isDirty || !state.isValid) return true
  if (state.values !== undefined && lastSaved !== null && serializedAtStart === lastSaved) {
    return true
  }
  return false
}

interface ErrorRetryOptions {
  err: unknown
  isMounted: boolean
  interval: number
  maxRetries: number
  consecutiveErrorsRef: React.MutableRefObject<number>
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  execute: () => void
  ctx: SaveStateContext
  clearTimer: () => void
}

function handleSaveError({
  err,
  isMounted,
  interval,
  maxRetries,
  consecutiveErrorsRef,
  timerRef,
  execute,
  ctx,
  clearTimer,
}: ErrorRetryOptions): void {
  consecutiveErrorsRef.current += 1
  if (isMounted) {
    handleSaveFailure(err, ctx)
  }

  const retryDelay = calculateRetryDelay(err, consecutiveErrorsRef.current, interval, maxRetries)
  if (isMounted && retryDelay !== null) {
    clearTimer()
    timerRef.current = setTimeout(execute, retryDelay)
  }
}

interface FinalizeSaveOptions {
  inFlightRef: React.MutableRefObject<boolean>
  inFlightPromiseRef: React.MutableRefObject<Promise<Record<string, unknown>> | null>
  pendingSaveRef: React.MutableRefObject<boolean>
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  isMounted: boolean
  interval: number
  execute: () => void
  clearTimer: () => void
}

function finalizeSave({
  inFlightRef,
  inFlightPromiseRef,
  pendingSaveRef,
  timerRef,
  isMounted,
  interval,
  execute,
  clearTimer,
}: FinalizeSaveOptions): void {
  inFlightRef.current = false
  inFlightPromiseRef.current = null

  if (!pendingSaveRef.current) return
  pendingSaveRef.current = false
  clearTimer()

  if (isMounted) {
    timerRef.current = setTimeout(execute, interval)
  } else {
    execute()
  }
}

export function useAutosave({
  enabled,
  interval,
  isDirty,
  isValid,
  values,
  maxRetries = DEFAULT_MAX_RETRIES,
  onSave,
  onSuccess,
}: UseAutosaveOptions): UseAutosaveReturn {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [consecutiveErrors, setConsecutiveErrors] = useState(0)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const inFlightPromiseRef = useRef<Promise<Record<string, unknown>> | null>(null)
  const pendingSaveRef = useRef(false)
  const cancelledRef = useRef(false)
  const isMountedRef = useRef(true)
  const consecutiveErrorsRef = useRef(0)
  const onSaveRef = useRef(onSave)
  const onSuccessRef = useRef(onSuccess)
  const lastSavedValuesRef = useRef<string | null>(null)
  const stateRef = useRef({ enabled, isDirty, isValid, interval, values, maxRetries })

  onSaveRef.current = onSave
  onSuccessRef.current = onSuccess
  stateRef.current = { enabled, isDirty, isValid, interval, values, maxRetries }

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cancelAutosave = useCallback(async () => {
    clearTimer()
    cancelledRef.current = true
    pendingSaveRef.current = false
    const promise = inFlightPromiseRef.current
    if (promise) {
      try {
        await promise
      } catch {
        // ignore in-flight error during cancel
      }
    }
    lastSavedValuesRef.current = null
    consecutiveErrorsRef.current = 0
    setStatus('idle')
    setConsecutiveErrors(0)
    setErrorMessage(null)
  }, [clearTimer])

  const executeAutosave = useCallback(async () => {
    const valuesToSave = stateRef.current.values
    const serializedAtStart = valuesToSave !== undefined ? serializeValues(valuesToSave) : null

    if (shouldSkipSave(stateRef.current, serializedAtStart, lastSavedValuesRef.current)) {
      return
    }

    if (inFlightRef.current) {
      pendingSaveRef.current = true
      return
    }

    inFlightRef.current = true
    cancelledRef.current = false
    if (isMountedRef.current) {
      setStatus('saving')
    }

    const ctx: SaveStateContext = {
      setStatus,
      setLastSavedAt,
      setErrorMessage,
      setConsecutiveErrors,
      lastSavedValuesRef,
    }

    try {
      const savePromise = onSaveRef.current()
      inFlightPromiseRef.current = savePromise
      const savedDoc = await savePromise
      if (cancelledRef.current) return
      consecutiveErrorsRef.current = 0
      handleSaveSuccess(
        savedDoc,
        serializedAtStart,
        onSuccessRef.current,
        isMountedRef.current,
        ctx,
      )
    } catch (err) {
      if (!cancelledRef.current) {
        handleSaveError({
          err,
          isMounted: isMountedRef.current,
          interval: stateRef.current.interval,
          maxRetries: stateRef.current.maxRetries ?? DEFAULT_MAX_RETRIES,
          consecutiveErrorsRef,
          timerRef,
          execute: () => void executeAutosave(),
          ctx,
          clearTimer,
        })
      }
    } finally {
      if (!cancelledRef.current) {
        finalizeSave({
          inFlightRef,
          inFlightPromiseRef,
          pendingSaveRef,
          timerRef,
          isMounted: isMountedRef.current,
          interval: stateRef.current.interval,
          execute: () => void executeAutosave(),
          clearTimer,
        })
      } else {
        inFlightRef.current = false
        inFlightPromiseRef.current = null
      }
    }
  }, [clearTimer])

  const flush = useCallback(async () => {
    clearTimer()
    const inFlight = inFlightPromiseRef.current
    if (inFlight) {
      try {
        await inFlight
      } catch {
        // ignore in-flight error during flush
      }
    }
    const valuesToSave = stateRef.current.values
    const serializedAtStart = valuesToSave !== undefined ? serializeValues(valuesToSave) : null
    if (!shouldSkipSave(stateRef.current, serializedAtStart, lastSavedValuesRef.current)) {
      await executeAutosave()
    }
  }, [clearTimer, executeAutosave])

  const hasValues = values !== undefined
  const serializedValues = useMemo(
    () => (hasValues ? serializeValues(values) : null),
    [hasValues, values],
  )

  useEffect(() => {
    if (!enabled || !isDirty || !isValid) {
      clearTimer()
      return
    }

    if (
      hasValues &&
      lastSavedValuesRef.current !== null &&
      serializedValues === lastSavedValuesRef.current
    ) {
      clearTimer()
      return
    }

    cancelledRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      void executeAutosave()
    }, interval)

    return clearTimer
  }, [
    enabled,
    isDirty,
    isValid,
    interval,
    hasValues,
    serializedValues,
    clearTimer,
    executeAutosave,
  ])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      clearTimer()
      const valuesToSave = stateRef.current.values
      const serialized = valuesToSave !== undefined ? serializeValues(valuesToSave) : null
      const hasPendingWork = !shouldSkipSave(
        stateRef.current,
        serialized,
        lastSavedValuesRef.current,
      )
      if (hasPendingWork && !cancelledRef.current) {
        void executeAutosave()
      }
    }
  }, [clearTimer, executeAutosave])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const valuesToSave = stateRef.current.values
      const serialized = valuesToSave !== undefined ? serializeValues(valuesToSave) : null
      const hasUnsavedWork =
        !shouldSkipSave(stateRef.current, serialized, lastSavedValuesRef.current) ||
        inFlightRef.current
      if (hasUnsavedWork && !cancelledRef.current) {
        e.preventDefault()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  return {
    status,
    lastSavedAt,
    errorMessage,
    consecutiveErrors,
    cancelAutosave,
    flush,
  }
}
