import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAutosave, type UseAutosaveOptions } from './useAutosave'
import { ApiClientError } from '../api/client'

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

  it('stops retrying on 4xx client errors and waits for the next user edit (#288)', async () => {
    let rejectSave!: (err: unknown) => void
    let resolveSecondSave!: (val: Record<string, unknown>) => void

    const onSave = vi.fn().mockImplementation(() => {
      const callIndex = onSave.mock.calls.length
      if (callIndex === 1) {
        return new Promise((_, rej) => {
          rejectSave = rej
        })
      }
      return new Promise<Record<string, unknown>>((res) => {
        resolveSecondSave = res
      })
    })

    const { rerender, result } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: {
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        values: { slug: 'taken-slug' },
        onSave,
      },
    })

    // Advance debounce timer to trigger first save
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.status).toBe('saving')

    // Reject with a 400 validation error (e.g. slug already taken)
    await act(async () => {
      rejectSave(new ApiClientError('Validation error', 400, [{ message: 'Slug already taken' }]))
      await Promise.resolve()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toBe('Validation error: Slug already taken')
    expect(result.current.consecutiveErrors).toBe(1)

    // Advance timers significantly: should NOT retry automatically
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    // User edits the form to fix the error
    rerender({
      enabled: true,
      interval: 1000,
      isDirty: true,
      isValid: true,
      values: { slug: 'new-unique-slug' },
      onSave,
    })

    // Advance debounce timer for new edit
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saving')

    // Resolve second save
    await act(async () => {
      resolveSecondSave({ id: 1, slug: 'new-unique-slug' })
      await Promise.resolve()
    })

    expect(result.current.status).toBe('saved')
    expect(result.current.errorMessage).toBeNull()
    expect(result.current.consecutiveErrors).toBe(0)
  })

  it('backs off with exponential delay and caps retries on 5xx or network errors (#288)', async () => {
    let rejectSave!: (err: Error) => void
    const onSave = vi.fn().mockImplementation(() => {
      return new Promise((_, rej) => {
        rejectSave = rej
      })
    })

    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        values: { title: 'Test' },
        maxRetries: 3,
        onSave,
      }),
    )

    // Initial save at t=1000
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    // Failure 1 (attempt 1) -> retry delay: 1000ms * 2^0 = 1000ms
    await act(async () => {
      rejectSave(new Error('Server error 1'))
      await Promise.resolve()
    })
    expect(result.current.consecutiveErrors).toBe(1)

    // Advance 999ms (not yet fired)
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    // Advance 1ms (fires retry 1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onSave).toHaveBeenCalledTimes(2)

    // Failure 2 (attempt 2) -> retry delay: 1000ms * 2^1 = 2000ms
    await act(async () => {
      rejectSave(new Error('Server error 2'))
      await Promise.resolve()
    })
    expect(result.current.consecutiveErrors).toBe(2)

    // Advance 1999ms (not yet fired)
    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(onSave).toHaveBeenCalledTimes(2)

    // Advance 1ms (fires retry 2)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onSave).toHaveBeenCalledTimes(3)

    // Failure 3 (attempt 3) -> retry delay: 1000ms * 2^2 = 4000ms
    await act(async () => {
      rejectSave(new Error('Server error 3'))
      await Promise.resolve()
    })
    expect(result.current.consecutiveErrors).toBe(3)

    // Advance 3999ms (not yet fired)
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(onSave).toHaveBeenCalledTimes(3)

    // Advance 1ms (fires retry 3)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onSave).toHaveBeenCalledTimes(4)

    // Failure 4 (attempt 4 > maxRetries 3) -> cap reached, should stop retrying
    await act(async () => {
      rejectSave(new Error('Server error 4'))
      await Promise.resolve()
    })
    expect(result.current.consecutiveErrors).toBe(4)

    // Advance 30 seconds: no further retries
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(onSave).toHaveBeenCalledTimes(4)
    expect(result.current.status).toBe('error')
  })

  it('still calls onSuccess to update query cache when an in-flight save resolves after unmount (#288)', async () => {
    let resolveSave!: (val: Record<string, unknown>) => void
    const onSave = vi.fn().mockImplementation(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        resolveSave = resolve
      })
    })
    const onSuccess = vi.fn()

    const { unmount } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        values: { title: 'In-flight doc' },
        onSave,
        onSuccess,
      }),
    )

    // Trigger save
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    // Unmount before save resolves (simulating navigation)
    unmount()

    // Resolve in-flight save
    const savedDoc = { id: 1, title: 'In-flight doc' }
    await act(async () => {
      resolveSave(savedDoc)
      await Promise.resolve()
    })

    // onSuccess must be called so query cache is updated with server doc
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith(savedDoc)
  })

  it('flushes pending debounced edits on unmount (#288)', async () => {
    let resolveSave!: (val: Record<string, unknown>) => void
    const onSave = vi.fn().mockImplementation(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        resolveSave = resolve
      })
    })
    const onSuccess = vi.fn()

    const { unmount } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 1000,
        isDirty: true,
        isValid: true,
        values: { title: 'Unsaved edit before unmount' },
        onSave,
        onSuccess,
      }),
    )

    // Only 200ms elapsed (debounce interval of 1000ms has not passed yet)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onSave).not.toHaveBeenCalled()

    // Component unmounts (e.g. user clicks breadcrumb/nav link)
    unmount()

    // Unmount must immediately flush the pending save
    expect(onSave).toHaveBeenCalledTimes(1)

    // When save finishes, onSuccess is called to update cache
    const savedDoc = { id: 1, title: 'Unsaved edit before unmount' }
    await act(async () => {
      resolveSave(savedDoc)
      await Promise.resolve()
    })

    expect(onSuccess).toHaveBeenCalledWith(savedDoc)
  })

  it('does not flush on unmount when form has no pending edits or is clean (#288)', () => {
    const onSave = vi.fn().mockResolvedValue({ id: 1 })

    const { unmount } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 1000,
        isDirty: false,
        isValid: true,
        values: { title: 'clean' },
        onSave,
      }),
    )

    unmount()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('flushes pending save programmatically via flush (#288)', async () => {
    const savedDoc = { id: 1, title: 'Flushed' }
    const onSave = vi.fn().mockResolvedValue(savedDoc)
    const onSuccess = vi.fn()

    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        interval: 5000,
        isDirty: true,
        isValid: true,
        values: { title: 'Flushed' },
        onSave,
        onSuccess,
      }),
    )

    // Advance 500ms (debounce has not passed)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onSave).not.toHaveBeenCalled()

    // Explicitly call flush()
    await act(async () => {
      await result.current.flush()
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith(savedDoc)
    expect(result.current.status).toBe('saved')
  })
})
