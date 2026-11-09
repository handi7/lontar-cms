import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeLivePreview } from './index'

describe('subscribeLivePreview', () => {
  const originalTop = window.top

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(window, 'top', {
      value: originalTop,
      configurable: true,
    })
  })

  it('does nothing when running outside an iframe (window.self === window.top)', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const onChange = vi.fn()

    const unsubscribe = subscribeLivePreview({
      initialData: { title: 'Initial' },
      serverURL: 'http://localhost:3000',
      onChange,
    })

    expect(addEventListenerSpy).not.toHaveBeenCalled()
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })

  it('subscribes and receives valid preview messages when inside an iframe', () => {
    // Mock inside iframe: window.self !== window.top
    const mockTop = {} as Window
    Object.defineProperty(window, 'top', {
      value: mockTop,
      configurable: true,
    })

    const onChange = vi.fn()
    const unsubscribe = subscribeLivePreview({
      initialData: { title: 'Initial' },
      serverURL: 'http://localhost:3000',
      collection: 'posts',
      onChange,
    })

    // Dispatch message with matching origin, collection and version
    const event = new MessageEvent('message', {
      origin: 'http://localhost:3000',
      data: {
        source: 'lontar-preview',
        version: 1,
        collection: 'posts',
        document: { title: 'Updated Title' },
      },
    })
    window.dispatchEvent(event)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ title: 'Updated Title' })

    unsubscribe()

    // After unsubscribe, further events are ignored
    window.dispatchEvent(event)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('rejects messages from untrusted origins', () => {
    const mockTop = {} as Window
    Object.defineProperty(window, 'top', {
      value: mockTop,
      configurable: true,
    })

    const onChange = vi.fn()
    const unsubscribe = subscribeLivePreview({
      initialData: { title: 'Initial' },
      serverURL: 'http://localhost:3000',
      onChange,
    })

    // Evil origin
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://evil.com',
        data: {
          source: 'lontar-preview',
          version: 1,
          collection: 'posts',
          document: { title: 'Hacked' },
        },
      }),
    )

    expect(onChange).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('rejects messages with wrong source, version, or collection', () => {
    const mockTop = {} as Window
    Object.defineProperty(window, 'top', {
      value: mockTop,
      configurable: true,
    })

    const onChange = vi.fn()
    const unsubscribe = subscribeLivePreview({
      initialData: { title: 'Initial' },
      serverURL: 'http://localhost:3000',
      collection: 'articles',
      onChange,
    })

    // Wrong source
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://localhost:3000',
        data: {
          source: 'other-source',
          version: 1,
          collection: 'articles',
          document: { title: 'Ignored' },
        },
      }),
    )

    // Wrong version
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://localhost:3000',
        data: {
          source: 'lontar-preview',
          version: 2,
          collection: 'articles',
          document: { title: 'Ignored' },
        },
      }),
    )

    // Wrong collection
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://localhost:3000',
        data: {
          source: 'lontar-preview',
          version: 1,
          collection: 'products',
          document: { title: 'Ignored' },
        },
      }),
    )

    // Malformed data
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://localhost:3000',
        data: 'plain string',
      }),
    )

    expect(onChange).not.toHaveBeenCalled()
    unsubscribe()
  })
})
