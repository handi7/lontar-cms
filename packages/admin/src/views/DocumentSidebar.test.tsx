import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DocumentSidebar } from './DocumentSidebar'

describe('DocumentSidebar', () => {
  afterEach(cleanup)

  it('renders primary submit button with given label and responds to pending state', () => {
    const { rerender } = render(
      <DocumentSidebar mode="create" submitLabel="Create Post" isPending={false} />,
    )

    const button = screen.getByRole('button', { name: 'Create Post' })
    expect(button).toBeTruthy()
    expect(button.getAttribute('disabled')).toBeNull()

    rerender(<DocumentSidebar mode="create" submitLabel="Saving..." isPending={true} />)
    const pendingButton = screen.getByRole('button', { name: 'Saving...' })
    expect(pendingButton.getAttribute('disabled')).not.toBeNull()
  })

  it('renders delete button in edit mode when enabled, and calls onDelete when clicked', () => {
    const onDelete = vi.fn()
    render(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        showDelete={true}
        onDelete={onDelete}
      />,
    )

    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    expect(deleteButton).toBeTruthy()
    fireEvent.click(deleteButton)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('does not render delete button in create mode or when showDelete is false', () => {
    const onDelete = vi.fn()
    const { rerender } = render(
      <DocumentSidebar
        mode="create"
        submitLabel="Create Post"
        isPending={false}
        showDelete={true}
        onDelete={onDelete}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()

    rerender(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        showDelete={false}
        onDelete={onDelete}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('disables delete button when isDeleting is true', () => {
    render(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        showDelete={true}
        isDeleting={true}
        onDelete={vi.fn()}
      />,
    )

    const deleteBtn = screen.getByRole('button', { name: 'Delete' })
    expect(deleteBtn.getAttribute('disabled')).not.toBeNull()
  })

  it('renders document metadata (ID, Created, Updated) in edit mode', () => {
    const doc = {
      id: 42,
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-02T12:00:00.000Z',
    }

    render(<DocumentSidebar mode="edit" submitLabel="Save Changes" isPending={false} doc={doc} />)

    expect(screen.getByText('ID')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('Created')).toBeTruthy()
    expect(screen.getByText('Updated')).toBeTruthy()
  })

  it('hides ID row when showId is false', () => {
    const doc = {
      id: 42,
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-02T12:00:00.000Z',
    }

    render(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        showId={false}
        doc={doc}
      />,
    )

    expect(screen.queryByText('ID')).toBeNull()
    expect(screen.getByText('Created')).toBeTruthy()
  })

  it('has responsive sticky sidebar layout classes', () => {
    render(<DocumentSidebar mode="create" submitLabel="Create Post" isPending={false} />)

    const aside = screen.getByRole('complementary', { name: 'Document sidebar' })
    expect(aside.className).toContain('lt:w-full')
    expect(aside.className).toContain('lg:lt:w-[300px]')
    expect(aside.className).toContain('lt:order-first')
    expect(aside.className).toContain('lg:lt:order-none')
    expect(aside.className).toContain('lg:lt:sticky')
    expect(aside.className).toContain('lg:lt:top-8')
  })
})
