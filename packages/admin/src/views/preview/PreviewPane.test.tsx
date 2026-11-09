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

  it('renders iframe when tokens are populated', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}?id={id}"
        values={{ slug: 'hello-world', id: 123 }}
        onClose={onClose}
      />,
    )

    expect(screen.queryByText('Preview pending')).toBeNull()
    const iframe = screen.getByTitle<HTMLIFrameElement>('Live Preview')
    expect(iframe).toBeTruthy()
    expect(iframe.src).toBe('https://example.com/posts/hello-world?id=123')
  })

  it('switches viewport presets when clicked', () => {
    const onClose = vi.fn()
    render(
      <PreviewPane
        collectionSlug="posts"
        urlTemplate="https://example.com/posts/{slug}"
        values={{ slug: 'test-post' }}
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
        onClose={onClose}
      />,
    )

    const closeButton = screen.getByTitle('Close preview')
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
