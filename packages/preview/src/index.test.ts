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

  it('drops omitted keys below the top level (e.g. un-bolding text or removing links) (#285)', () => {
    const initial = {
      title: 'Post',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Bold text',
                marks: [{ type: 'bold' }],
              },
            ],
          },
        ],
      },
    }

    const incoming = {
      title: 'Post',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Unbolded text',
              },
            ],
          },
        ],
      },
    }

    const merged = mergeLivePreviewData(initial, incoming)
    const textNode = (
      merged.content as { content: Array<{ content: Array<Record<string, unknown>> }> }
    ).content[0]!.content[0]!
    expect(textNode.text).toBe('Unbolded text')
    expect(textNode).not.toHaveProperty('marks')
  })

  it('does not merge array items without id by index when items are deleted or cleared (#285)', () => {
    const initial = {
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { textAlign: 'center' },
            content: [{ type: 'text', text: 'Paragraph 1', marks: [{ type: 'italic' }] }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Paragraph 2' }],
          },
        ],
      },
    }

    // Paragraph 1 was deleted; only Paragraph 2 remains
    const incoming = {
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Paragraph 2' }],
          },
        ],
      },
    }

    const merged = mergeLivePreviewData(initial, incoming)
    const paragraphs = (merged.content as { content: Array<Record<string, unknown>> }).content
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]).not.toHaveProperty('attrs')
    const textNode = (paragraphs[0]!.content as Array<Record<string, unknown>>)[0]!
    expect(textNode.text).toBe('Paragraph 2')
    expect(textNode).not.toHaveProperty('marks')
  })

  it('drops removed keys in nested group fields below top-level (#285)', () => {
    const initial = {
      id: 1,
      createdAt: '2026-10-31T00:00:00.000Z',
      meta: {
        description: 'Old desc',
        keywords: 'cms, blog',
      },
    }

    const incoming = {
      meta: {
        description: 'New desc',
      },
    }

    const merged = mergeLivePreviewData(initial, incoming)
    expect(merged.id).toBe(1)
    expect(merged.createdAt).toBe('2026-10-31T00:00:00.000Z')
    expect(merged.meta).toEqual({
      description: 'New desc',
    })
    expect(merged.meta).not.toHaveProperty('keywords')
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

  it('merges consecutive messages over initialData, allowing relation toggles A -> B -> A to retain populated entity (#285)', () => {
    const mockTop = {} as Window
    Object.defineProperty(window, 'top', {
      value: mockTop,
      configurable: true,
    })

    const initialData = {
      title: 'Initial Post',
      author: { id: 1, name: 'Alice Author' },
      categories: [
        { id: 10, name: 'Tech' },
        { id: 20, name: 'Design' },
      ],
    }

    const onChange = vi.fn()
    const unsubscribe = subscribeLivePreview({
      initialData,
      serverURL: 'http://localhost:3000',
      collection: 'posts',
      onChange,
    })

    const send = (document: unknown) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://localhost:3000',
          data: {
            source: 'lontar-preview',
            version: 1,
            collection: 'posts',
            document,
          },
        }),
      )
    }

    // 1. Author remains 1, categories [10, 20]
    send({ title: 'Edit 1', author: 1, categories: [10, 20] })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Edit 1',
        author: { id: 1, name: 'Alice Author' },
        categories: [
          { id: 10, name: 'Tech' },
          { id: 20, name: 'Design' },
        ],
      }),
    )

    // 2. Author changed to 2 (unpopulated/bare id), categories [20]
    send({ title: 'Edit 2', author: 2, categories: [20] })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Edit 2',
        author: 2,
        categories: [{ id: 20, name: 'Design' }],
      }),
    )

    // 3. Author changed BACK to 1, categories [10, 20]
    send({ title: 'Edit 3', author: 1, categories: [10, 20] })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Edit 3',
        author: { id: 1, name: 'Alice Author' },
        categories: [
          { id: 10, name: 'Tech' },
          { id: 20, name: 'Design' },
        ],
      }),
    )

    unsubscribe()
  })
})
