import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutosaveStatus } from '../views/AutosaveIndicator'

export interface UseAutosaveOptions {
  enabled: boolean
  interval: number
  isDirty: boolean
  isValid: boolean
  onSave: () => Promise<Record<string, unknown>>
  onSuccess?: (savedDoc: Record<string, unknown>) => void
}

export interface UseAutosaveReturn {
  status: AutosaveStatus
  lastSavedAt: Date | null
  errorMessage: string | null
  consecutiveErrors: number
  cancelAutosave: () => void
}

export function useAutosave({
  enabled,
  interval,
  isDirty,
  isValid,
  onSave,
  onSuccess,
}: UseAutosaveOptions): UseAutosaveReturn {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [consecutiveErrors, setConsecutiveErrors] = useState(0)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const cancelledRef = useRef(false)
  const onSaveRef = useRef(onSave)
  const onSuccessRef = useRef(onSuccess)
  const stateRef = useRef({ enabled, isDirty, isValid, interval })

  onSaveRef.current = onSave
  onSuccessRef.current = onSuccess
  stateRef.current = { enabled, isDirty, isValid, interval }

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cancelAutosave = useCallback(() => {
    clearTimer()
    cancelledRef.current = true
    setStatus('idle')
    setConsecutiveErrors(0)
    setErrorMessage(null)
  }, [clearTimer])

  const executeAutosave = useCallback(async () => {
    const { enabled: isEnabled, isDirty: dirty, isValid: valid } = stateRef.current
    if (!isEnabled || !dirty || !valid || inFlightRef.current) return

    inFlightRef.current = true
    cancelledRef.current = false
    setStatus('saving')

    try {
      const savedDoc = await onSaveRef.current()
      if (cancelledRef.current) return

      setStatus('saved')
      setLastSavedAt(new Date())
      setErrorMessage(null)
      setConsecutiveErrors(0)
      onSuccessRef.current?.(savedDoc)
    } catch (err) {
      if (cancelledRef.current) return

      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Autosave failed')
      setConsecutiveErrors((prev) => prev + 1)

      // Schedule retry if still dirty and valid
      clearTimer()
      timerRef.current = setTimeout(() => {
        void executeAutosave()
      }, stateRef.current.interval)
    } finally {
      inFlightRef.current = false
    }
  }, [clearTimer])

  useEffect(() => {
    if (!enabled || !isDirty || !isValid) {
      clearTimer()
      return
    }

    cancelledRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      void executeAutosave()
    }, interval)

    return clearTimer
  }, [enabled, isDirty, isValid, interval, clearTimer, executeAutosave])

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
