import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeLivePreviewData, subscribeLivePreview } from './index'

describe('mergeLivePreviewData', () => {
  it('updates primitive fields from incoming data', () => {
    const initial = { title: 'Old Title', views: 10, isDraft: true }
    const incoming = { title: 'New Title', views: 15, isDraft: false }
    expect(mergeLivePreviewData(initial, incoming)).toEqual(incoming)
  })

  it('preserves populated single relation and upload objects when incoming is the same id', () => {
    const initial = {
      title: 'Post Title',
      author: { id: 1, name: 'Alice Author', bio: 'Author bio' },
      cover: { id: 2, url: '/media/banner.png', filename: 'banner.png' },
    }
    const incoming = {
      title: 'Updated Post Title',
      author: 1,
      cover: 2,
    }

    const merged = mergeLivePreviewData(initial, incoming)
    expect(merged.title).toBe('Updated Post Title')
    expect(merged.author).toEqual({ id: 1, name: 'Alice Author', bio: 'Author bio' })
    expect(merged.cover).toEqual({ id: 2, url: '/media/banner.png', filename: 'banner.png' })
  })

  it('replaces relation with bare id when the id changes to a new value', () => {
    const initial = {
      author: { id: 1, name: 'Alice Author' },
    }
    const incoming = {
      author: 99,
    }

    const merged = mergeLivePreviewData(initial, incoming)
    expect(merged.author).toBe(99)
  })

  it('preserves populated items in hasMany relationship arrays', () => {
    const initial = {
      categories: [
        { id: 1, name: 'Tech' },
        { id: 2, name: 'News' },
        { id: 3, name: 'Design' },
      ],
    }
    const incoming = {
      // Reordered and removed 2
      categories: [3, 1],
    }

    const merged = mergeLivePreviewData(initial, incoming)
    expect(merged.categories).toEqual([
      { id: 3, name: 'Design' },
      { id: 1, name: 'Tech' },
    ])
  })

  it('preserves populated items inside nested group, array and blocks fields', () => {
    const initial = {
      metadata: {
        reviewer: { id: 10, name: 'Reviewer Bob' },
      },
      gallery: [{ id: 'item-1', image: { id: 5, url: '/cat.jpg' }, caption: 'A cat' }],
      layout: [
        {
          id: 'block-1',
          blockType: 'hero',
          headline: 'Initial Headline',
          bgImage: { id: 8, url: '/hero.png' },
        },
      ],
    }

    const incoming = {
      metadata: {
        reviewer: 10,
      },
      gallery: [{ id: 'item-1', image: 5, caption: 'A cute cat' }],
      layout: [
        {
          id: 'block-1',
          blockType: 'hero',
          headline: 'Live Edited Headline',
          bgImage: 8,
        },
      ],
    }

    const merged = mergeLivePreviewData(initial, incoming)
    expect(merged.metadata.reviewer).toEqual({ id: 10, name: 'Reviewer Bob' })
    expect(merged.gallery[0]).toEqual({
      id: 'item-1',
      image: { id: 5, url: '/cat.jpg' },
      caption: 'A cute cat',
    })
    expect(merged.layout[0]).toEqual({
      id: 'block-1',
      blockType: 'hero',
      headline: 'Live Edited Headline',
      bgImage: { id: 8, url: '/hero.png' },
    })
  })
})

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
