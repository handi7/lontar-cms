import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutosaveStatus } from '../views/AutosaveIndicator'

export interface UseAutosaveOptions {
  enabled: boolean
  interval: number
  isDirty: boolean
  isValid: boolean
  values?: unknown
  onSave: () => Promise<Record<string, unknown>>
  onSuccess?: (savedDoc: Record<string, unknown>) => void
}

export interface UseAutosaveReturn {
  status: AutosaveStatus
  lastSavedAt: Date | null
  errorMessage: string | null
  consecutiveErrors: number
  cancelAutosave: () => Promise<void>
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
  ctx: SaveStateContext,
): void {
  ctx.setStatus('saved')
  ctx.setLastSavedAt(new Date())
  ctx.setErrorMessage(null)
  ctx.setConsecutiveErrors(() => 0)
  if (savedValuesSerialized !== null) {
    ctx.lastSavedValuesRef.current = savedValuesSerialized
  }
  onSuccess?.(savedDoc)
}

function handleSaveFailure(err: unknown, ctx: SaveStateContext): void {
  ctx.setStatus('error')
  ctx.setErrorMessage(err instanceof Error ? err.message : 'Autosave failed')
  ctx.setConsecutiveErrors((prev) => prev + 1)
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

export function useAutosave({
  enabled,
  interval,
  isDirty,
  isValid,
  values,
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
  const onSaveRef = useRef(onSave)
  const onSuccessRef = useRef(onSuccess)
  const lastSavedValuesRef = useRef<string | null>(null)
  const stateRef = useRef({ enabled, isDirty, isValid, interval, values })

  onSaveRef.current = onSave
  onSuccessRef.current = onSuccess
  stateRef.current = { enabled, isDirty, isValid, interval, values }

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
    setStatus('saving')

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
      handleSaveSuccess(savedDoc, serializedAtStart, onSuccessRef.current, ctx)
    } catch (err) {
      if (cancelledRef.current) return
      handleSaveFailure(err, ctx)

      clearTimer()
      timerRef.current = setTimeout(() => {
        void executeAutosave()
      }, stateRef.current.interval)
    } finally {
      inFlightRef.current = false
      inFlightPromiseRef.current = null
      if (pendingSaveRef.current && !cancelledRef.current) {
        pendingSaveRef.current = false
        clearTimer()
        timerRef.current = setTimeout(() => {
          void executeAutosave()
        }, stateRef.current.interval)
      }
    }
  }, [clearTimer])

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
    return () => {
      clearTimer()
      cancelledRef.current = true
    }
  }, [clearTimer])

  return {
    status,
    lastSavedAt,
    errorMessage,
    consecutiveErrors,
    cancelAutosave,
  }
}
