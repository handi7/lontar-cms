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
})
