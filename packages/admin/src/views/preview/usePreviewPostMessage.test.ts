import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePreviewPostMessage } from './usePreviewPostMessage'

describe('usePreviewPostMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('posts message to targetOrigin after debounce interval', () => {
    const postMessage = vi.fn()
    const iframe = {
      contentWindow: { postMessage },
    } as unknown as HTMLIFrameElement

    const iframeRef = { current: iframe }

    const { rerender } = renderHook(
      (props) =>
        usePreviewPostMessage({
          iframeRef,
          enabled: true,
          targetOrigin: 'https://example.com',
          collectionSlug: 'posts',
          values: props.values,
          debounceMs: 150,
        }),
      { initialProps: { values: { title: 'First' } } },
    )

    // Before timer advances: no message
    expect(postMessage).not.toHaveBeenCalled()

    // Advance 100ms: still nothing
    vi.advanceTimersByTime(100)
    expect(postMessage).not.toHaveBeenCalled()

    // Rerender with new values before debounce expires
    rerender({ values: { title: 'Second' } })

    // Advance 150ms
    vi.advanceTimersByTime(150)

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      {
        source: 'lontar-preview',
        version: 1,
        collection: 'posts',
        document: { title: 'Second' },
      },
      'https://example.com',
    )
  })

  it('never posts to wildcard "*" or when targetOrigin is missing', () => {
    const postMessage = vi.fn()
    const iframe = {
      contentWindow: { postMessage },
    } as unknown as HTMLIFrameElement
    const iframeRef = { current: iframe }

    const { result } = renderHook(() =>
      usePreviewPostMessage({
        iframeRef,
        enabled: true,
        targetOrigin: undefined,
        collectionSlug: 'posts',
        values: { title: 'No Origin' },
      }),
    )

    vi.advanceTimersByTime(500)
    expect(postMessage).not.toHaveBeenCalled()

    result.current.postImmediate()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('postImmediate sends the latest values immediately', () => {
    const postMessage = vi.fn()
    const iframe = {
      contentWindow: { postMessage },
    } as unknown as HTMLIFrameElement
    const iframeRef = { current: iframe }

    const { result } = renderHook(() =>
      usePreviewPostMessage({
        iframeRef,
        enabled: true,
        targetOrigin: 'https://example.com',
        collectionSlug: 'posts',
        values: { title: 'Immediate' },
      }),
    )

    result.current.postImmediate()
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      {
        source: 'lontar-preview',
        version: 1,
        collection: 'posts',
        document: { title: 'Immediate' },
      },
      'https://example.com',
    )
  })
})
