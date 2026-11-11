import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAutosave, type UseAutosaveOptions } from './useAutosave'

describe('useAutosave hook', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('remains idle when disabled, not dirty, or invalid', () => {
    const onSave = vi.fn().mockResolvedValue({})
    const { result, rerender } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: {
        enabled: false,
        interval: 1000,
        isDirty: true,
        isValid: true,
        onSave,
      },
    })

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.status).toBe('idle')
    expect(onSave).not.toHaveBeenCalled()

    // When dirty is false
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: false,
      isValid: true,
      onSave,
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.status).toBe('idle')
    expect(onSave).not.toHaveBeenCalled()

    // When valid is false
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: true,
      isValid: false,
      onSave,
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.status).toBe('idle')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('triggers debounced autosave and transitions from saving to saved', async () => {
    const savedDoc = { id: 1, title: 'Autosaved Title' }
    let resolveSave!: (val: typeof savedDoc) => void
    const onSave = vi.fn().mockImplementation(
      () =>
        new Promise<typeof savedDoc>((res) => {
          resolveSave = res
        }),
    )
    const onSuccess = vi.fn()

    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        onSave,
        onSuccess,
      }),
    )

    expect(result.current.status).toBe('idle')

    // Advance 500ms (debounce has not expired yet)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.status).toBe('idle')
    expect(onSave).not.toHaveBeenCalled()

    // Advance another 500ms (timer fires)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('saving')

    // Resolve the promise
    await act(async () => {
      resolveSave(savedDoc)
      await Promise.resolve()
    })

    expect(result.current.status).toBe('saved')
    expect(result.current.lastSavedAt).toBeInstanceOf(Date)
    expect(onSuccess).toHaveBeenCalledWith(savedDoc)
  })

  it('handles save error and schedules retry', async () => {
    let rejectSave!: (err: Error) => void
    const onSave = vi.fn().mockImplementation(
      () =>
        new Promise((_, rej) => {
          rejectSave = rej
        }),
    )

    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        onSave,
      }),
    )

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.status).toBe('saving')

    await act(async () => {
      rejectSave(new Error('Network error'))
      await Promise.resolve()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toBe('Network error')
    expect(result.current.consecutiveErrors).toBe(1)

    // Verify retry timer is scheduled after interval
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('cancels pending autosave and resets state on cancelAutosave', () => {
    const onSave = vi.fn().mockResolvedValue({})

    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        onSave,
      }),
    )

    act(() => {
      vi.advanceTimersByTime(500)
      void result.current.cancelAutosave()
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.status).toBe('idle')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('awaits in-flight onSave when cancelAutosave is called (#245)', async () => {
    let resolveSave: ((val: Record<string, unknown>) => void) | null = null
    const onSave = vi.fn().mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveSave = resolve
        }),
    )

    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        onSave,
      }),
    )

    // Trigger autosave
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.status).toBe('saving')

    let cancelled = false
    const cancelPromise = result.current.cancelAutosave().then(() => {
      cancelled = true
    })

    // Before resolving save, cancelAutosave is still awaiting in-flight save
    expect(cancelled).toBe(false)

    // Resolve in-flight save
    await act(async () => {
      resolveSave?.({ id: 1 })
      await cancelPromise
    })

    expect(cancelled).toBe(true)
    expect(result.current.status).toBe('idle')
  })

  it('executes multiple autosave requests for successive value edits across intervals (#232)', async () => {
    let callCount = 0
    const onSave = vi.fn().mockImplementation(() => {
      callCount += 1
      return Promise.resolve({ id: 1, title: `Saved Title ${callCount}` })
    })

    const { rerender } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: {
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        values: { title: 'First Edit' },
        onSave,
      },
    })

    // Advance interval for first edit
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    // Second edit while still dirty
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: true,
      isValid: true,
      values: { title: 'Second Edit' },
      onSave,
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledTimes(2)

    // Third edit while still dirty
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: true,
      isValid: true,
      values: { title: 'Third Edit' },
      onSave,
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledTimes(3)
  })

  it('debounces rapid keystrokes so only the final value is saved (#232)', async () => {
    const onSave = vi.fn().mockResolvedValue({ id: 1 })

    const { rerender } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: {
        enabled: true,
        interval: 500,
        isDirty: true,
        isValid: true,
        values: { title: 'a' },
        onSave,
      },
    })

    // Advance 200ms and type again
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender({
      enabled: true,
      interval: 500,
      isDirty: true,
      isValid: true,
      values: { title: 'ab' },
      onSave,
    })

    // Advance another 200ms and type again
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender({
      enabled: true,
      interval: 500,
      isDirty: true,
      isValid: true,
      values: { title: 'abc' },
      onSave,
    })

    // 400ms total elapsed, but each keystroke reset the 500ms timer
    expect(onSave).not.toHaveBeenCalled()

    // Now wait the full 500ms debounce interval
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('saves edits made while an autosave is in flight (#287)', async () => {
    let resolveFirstSave!: (val: Record<string, unknown>) => void
    const savedValues: Array<Record<string, unknown>> = []

    const onSave = vi.fn().mockImplementation(() => {
      const callIndex = onSave.mock.calls.length
      if (callIndex === 1) {
        return new Promise<Record<string, unknown>>((resolve) => {
          resolveFirstSave = (doc) => {
            savedValues.push(doc)
            resolve(doc)
          }
        })
      }
      return Promise.resolve({ id: 1, title: '' })
    })

    const { rerender, result } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: {
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        values: { title: 'x' },
        onSave,
      },
    })

    // Advance 1000ms: first autosave starts with 'x'
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('saving')

    // While save 1 is in flight, user deletes value ('')
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: true,
      isValid: true,
      values: { title: '' },
      onSave,
    })

    // Resolve first save with title 'x'
    await act(async () => {
      resolveFirstSave({ id: 1, title: 'x' })
      await Promise.resolve()
    })

    expect(result.current.status).toBe('saved')

    // Debounce timer for the newer edit advances
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    // Second autosave should have fired for the in-flight edit
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('schedules pending save when debounce timer expires while save is in flight (#287)', async () => {
    let resolveFirstSave!: (val: Record<string, unknown>) => void

    const onSave = vi.fn().mockImplementation(() => {
      const callIndex = onSave.mock.calls.length
      if (callIndex === 1) {
        return new Promise<Record<string, unknown>>((resolve) => {
          resolveFirstSave = resolve
        })
      }
      return Promise.resolve({ id: 1, title: 'y' })
    })

    const { rerender } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: {
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        values: { title: 'x' },
        onSave,
      },
    })

    // Start first autosave
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    // Edit while in flight
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: true,
      isValid: true,
      values: { title: 'y' },
      onSave,
    })

    // Advance debounce interval while first save is still in flight
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    // Still in flight, so second save cannot run concurrently
    expect(onSave).toHaveBeenCalledTimes(1)

    // Resolve first save
    await act(async () => {
      resolveFirstSave({ id: 1, title: 'x' })
      await Promise.resolve()
    })

    // Finally block queues pending save after interval
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('skips redundant save if in-flight edit reverts back to saved values (#287)', async () => {
    let resolveFirstSave!: (val: Record<string, unknown>) => void

    const onSave = vi.fn().mockImplementation(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        resolveFirstSave = resolve
      })
    })

    const { rerender } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: {
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        values: { title: 'x' },
        onSave,
      },
    })

    // Start first autosave with 'x'
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    // Edit to 'y' while in flight
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: true,
      isValid: true,
      values: { title: 'y' },
      onSave,
    })

    // Revert back to 'x' while still in flight
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: true,
      isValid: true,
      values: { title: 'x' },
      onSave,
    })

    // Resolve first save
    await act(async () => {
      resolveFirstSave({ id: 1, title: 'x' })
      await Promise.resolve()
    })

    // Advance debounce timer
    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    // Should not save again because values match what was saved
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
