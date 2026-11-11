import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PreviewPane } from './PreviewPane'

afterEach(cleanup)

describe('PreviewPane', () => {
  it('renders pending placeholder when tokens are missing', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}?id={id}"
        values={{ title: 'My Post' }}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('Preview pending')).toBeTruthy()
    expect(screen.getByText(/Fill in "slug", "id" to start live preview\./i)).toBeTruthy()
    expect(screen.queryByTitle('Live Preview')).toBeNull()
  })

  it('renders iframe when tokens are populated in saved document', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}?id={id}"
        values={{ slug: 'hello-world', id: 123 }}
        savedValues={{ slug: 'hello-world', id: 123 }}
        onClose={onClose}
      />,
    )

    expect(screen.queryByText('Preview pending')).toBeNull()
    const iframe = screen.getByTitle<HTMLIFrameElement>('Live Preview')
    expect(iframe).toBeTruthy()
    expect(iframe.src).toBe('https://example.com/posts/hello-world?id=123')
  })

  it('prompts to save when tokens are populated in form but not in saved document', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}?id={id}"
        values={{ slug: 'hello-world', id: 123 }}
        savedValues={null}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('Preview pending')).toBeTruthy()
    expect(screen.getByText('Save to start live preview.')).toBeTruthy()
    expect(screen.queryByTitle('Live Preview')).toBeNull()
  })

  it('changing the slug in the form does not change the iframe src until save', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}"
        values={{ slug: 'initial-slug' }}
        savedValues={{ slug: 'initial-slug' }}
        onClose={onClose}
      />,
    )

    const iframe = screen.getByTitle<HTMLIFrameElement>('Live Preview')
    expect(iframe.src).toBe('https://example.com/posts/initial-slug')

    // Live form values change as user types in slug field
    rerender(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}"
        values={{ slug: 'unsaved-new-slug' }}
        savedValues={{ slug: 'initial-slug' }}
        onClose={onClose}
      />,
    )

    // iframe src remains on the saved slug to prevent 404 reload
    expect(iframe.src).toBe('https://example.com/posts/initial-slug')

    // After save completes, savedValues updates
    rerender(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}"
        values={{ slug: 'unsaved-new-slug' }}
        savedValues={{ slug: 'unsaved-new-slug' }}
        onClose={onClose}
      />,
    )

    // iframe src is now updated to the newly saved slug
    expect(iframe.src).toBe('https://example.com/posts/unsaved-new-slug')
  })

  it('switches viewport presets when clicked', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}"
        values={{ slug: 'test-post' }}
        savedValues={{ slug: 'test-post' }}
        onClose={onClose}
      />,
    )

    const tabletButton = screen.getByTitle(/Tablet view/i)
    fireEvent.click(tabletButton)

    const iframe = screen.getByTitle('Live Preview')
    expect(iframe.parentElement?.className).toContain('lt:w-[768px]')

    const mobileButton = screen.getByTitle(/Mobile view/i)
    fireEvent.click(mobileButton)
    expect(iframe.parentElement?.className).toContain('lt:w-[375px]')
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}"
        values={{ slug: 'test-post' }}
        savedValues={{ slug: 'test-post' }}
        onClose={onClose}
      />,
    )

    const closeButton = screen.getByTitle('Close preview')
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders scale percentage label in header when viewport is scaled down', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}"
        values={{ slug: 'test-post' }}
        savedValues={{ slug: 'test-post' }}
        onClose={onClose}
        containerWidth={500}
      />,
    )

    // Default is desktop: 100%, no scale label
    expect(screen.queryByTestId('preview-scale')).toBeNull()

    // Switch to tablet (768px): inside 500px container, available = 500 - 16 = 484px -> 484 / 768 = 63%
    const tabletButton = screen.getByTitle(/Tablet view/i)
    fireEvent.click(tabletButton)

    const scaleLabel = screen.getByTestId('preview-scale')
    expect(scaleLabel).toBeTruthy()
    expect(scaleLabel.textContent).toBe('63%')
    expect(scaleLabel.getAttribute('aria-label')).toBe('Preview scaled to 63%')

    // Switch to mobile (375px): 375px fits within 484px, scale = 100%, so label disappears
    const mobileButton = screen.getByTitle(/Mobile view/i)
    fireEvent.click(mobileButton)
    expect(screen.queryByTestId('preview-scale')).toBeNull()
  })

  it('renders mobile scale percentage label when container is narrower than mobile preset', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}"
        values={{ slug: 'test-post' }}
        savedValues={{ slug: 'test-post' }}
        onClose={onClose}
        containerWidth={300}
      />,
    )

    // Switch to mobile (375px): inside 300px container, available = 300 - 16 = 284px -> 284 / 375 = 76%
    const mobileButton = screen.getByTitle(/Mobile view/i)
    fireEvent.click(mobileButton)

    const scaleLabel = screen.getByTestId('preview-scale')
    expect(scaleLabel).toBeTruthy()
    expect(scaleLabel.textContent).toBe('76%')
  })
})
