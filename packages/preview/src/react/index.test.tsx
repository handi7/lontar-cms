import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useLivePreview } from './index'

interface SampleDoc {
  title: string
  content?: string
}

function PreviewConsumer({
  initialData,
  serverURL,
  collection,
}: {
  initialData: SampleDoc
  serverURL: string
  collection?: string
}) {
  const { data, isLive } = useLivePreview<SampleDoc>({
    initialData,
    serverURL,
    collection,
  })

  return (
    <div>
      <h1 data-testid="title">{data.title}</h1>
      <span data-testid="is-live">{isLive ? 'Live' : 'Static'}</span>
    </div>
  )
}

describe('useLivePreview', () => {
  const originalTop = window.top

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'top', {
      value: originalTop,
      configurable: true,
    })
  })

  it('renders initial data when outside an iframe', () => {
    render(
      <PreviewConsumer initialData={{ title: 'Static Post' }} serverURL="http://localhost:3000" />,
    )

    expect(screen.getByTestId('title').textContent).toBe('Static Post')
    expect(screen.getByTestId('is-live').textContent).toBe('Static')
  })

  it('updates state and flags isLive when valid postMessage arrives in iframe', () => {
    const mockTop = {} as Window
    Object.defineProperty(window, 'top', {
      value: mockTop,
      configurable: true,
    })

    render(
      <PreviewConsumer
        initialData={{ title: 'Original Post' }}
        serverURL="http://localhost:3000"
        collection="posts"
      />,
    )

    expect(screen.getByTestId('title').textContent).toBe('Original Post')
    expect(screen.getByTestId('is-live').textContent).toBe('Static')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://localhost:3000',
          data: {
            source: 'lontar-preview',
            version: 1,
            collection: 'posts',
            document: { title: 'Live Updated Post' },
          },
        }),
      )
    })

    expect(screen.getByTestId('title').textContent).toBe('Live Updated Post')
    expect(screen.getByTestId('is-live').textContent).toBe('Live')
  })

  it('preserves populated relation object when message arrives with bare id', () => {
    const mockTop = {} as Window
    Object.defineProperty(window, 'top', {
      value: mockTop,
      configurable: true,
    })

    interface DocWithAuthor {
      title: string
      author?: { id: number; name: string } | number
    }

    function AuthorPreviewConsumer({ initialData }: { initialData: DocWithAuthor }) {
      const { data } = useLivePreview<DocWithAuthor>({
        initialData,
        serverURL: 'http://localhost:3000',
        collection: 'posts',
      })

      const authorName =
        typeof data.author === 'object' && data.author !== null ? data.author.name : 'No author'

      return (
        <div>
          <h1 data-testid="title">{data.title}</h1>
          <span data-testid="author-name">{authorName}</span>
        </div>
      )
    }

    render(
      <AuthorPreviewConsumer
        initialData={{
          title: 'Initial Post',
          author: { id: 1, name: 'Alice Author' },
        }}
      />,
    )

    expect(screen.getByTestId('author-name').textContent).toBe('Alice Author')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://localhost:3000',
          data: {
            source: 'lontar-preview',
            version: 1,
            collection: 'posts',
            // Admin sends bare ID 1 for author:
            document: { title: 'Updated Title', author: 1 },
          },
        }),
      )
    })

    expect(screen.getByTestId('title').textContent).toBe('Updated Title')
    // Populated author object was preserved!
    expect(screen.getByTestId('author-name').textContent).toBe('Alice Author')
  })
})
