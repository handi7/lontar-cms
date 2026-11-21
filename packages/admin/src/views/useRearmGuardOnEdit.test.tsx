import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRearmGuardOnEdit } from './CollectionFormView'

describe('useRearmGuardOnEdit', () => {
  it('keeps the post-save exemption until the form turns dirty again', () => {
    const ref = { current: false }
    const { rerender } = renderHook(({ dirty }) => useRearmGuardOnEdit(dirty, ref), {
      initialProps: { dirty: true },
    })

    // Save: the exemption is set while the form is still dirty, then the form resets.
    ref.current = true
    rerender({ dirty: true })
    expect(ref.current).toBe(true)
    rerender({ dirty: false })
    expect(ref.current).toBe(true)

    // The next edit re-arms the unsaved-changes guard.
    rerender({ dirty: true })
    expect(ref.current).toBe(false)
  })
})
