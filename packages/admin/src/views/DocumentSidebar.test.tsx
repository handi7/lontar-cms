import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PortalContainerProvider } from '../context/PortalContainer'
import { openDropdownMenu } from '../test/radix'
import { DocumentSidebar } from './DocumentSidebar'

function renderWithPortal(ui: React.ReactElement) {
  return render(
    <div className="lontar-admin">
      <PortalContainerProvider>{ui}</PortalContainerProvider>
    </div>,
  )
}

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

  it('renders status badge and draft/publish split button when hasDrafts is true', () => {
    const onPublish = vi.fn()
    const onSaveDraft = vi.fn()
    const onUnpublish = vi.fn()

    renderWithPortal(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        hasDrafts={true}
        status="changed"
        doc={{ id: 1, _status: 'draft', _isPublished: true }}
        onPublish={onPublish}
        onSaveDraft={onSaveDraft}
        onUnpublish={onUnpublish}
      />,
    )

    // Status badge is rendered
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Changed')).toBeTruthy()

    // Publish button is rendered
    const publishBtn = screen.getByRole('button', { name: 'Publish' })
    expect(publishBtn).toBeTruthy()
    fireEvent.click(publishBtn)
    expect(onPublish).toHaveBeenCalledTimes(1)

    // Dropdown trigger
    const optionsBtn = screen.getByRole('button', { name: 'Publishing options' })
    expect(optionsBtn).toBeTruthy()
    openDropdownMenu(optionsBtn)

    // Dropdown options
    const saveDraftItem = screen.getByText('Save draft')
    expect(saveDraftItem).toBeTruthy()
    fireEvent.click(saveDraftItem)
    expect(onSaveDraft).toHaveBeenCalledTimes(1)

    // Unpublish is rendered since doc is changed / published
    openDropdownMenu(optionsBtn)
    const unpublishItem = screen.getByText('Unpublish')
    expect(unpublishItem).toBeTruthy()
    fireEvent.click(unpublishItem)
    expect(onUnpublish).toHaveBeenCalledTimes(1)
  })

  it('disables publish button while autosave is saving (#245)', () => {
    renderWithPortal(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        hasDrafts={true}
        autosave={{ status: 'saving', lastSavedAt: null }}
        doc={{ id: 1, _status: 'draft', _isPublished: true }}
      />,
    )

    const publishBtn = screen.getByRole('button', { name: 'Publish' })
    expect(publishBtn.getAttribute('disabled')).not.toBeNull()
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
    expect(aside.className).toContain('lt:@3xl:w-[300px]')
    expect(aside.className).toContain('lt:order-first')
    expect(aside.className).toContain('lt:@3xl:order-none')
    expect(aside.className).toContain('lt:@3xl:sticky')
    expect(aside.className).toContain('lt:@3xl:top-8')
  })

  it('renders version history button in edit mode when enabled, and calls onOpenHistory when clicked', () => {
    const onOpenHistory = vi.fn()
    render(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        hasVersions={true}
        onOpenHistory={onOpenHistory}
      />,
    )

    const btn = screen.getByRole('button', { name: 'Version History' })
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('does not render version history button in create mode or when hasVersions is false', () => {
    const { rerender } = render(
      <DocumentSidebar
        mode="create"
        submitLabel="Create Post"
        isPending={false}
        hasVersions={true}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Version History' })).toBeNull()

    rerender(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        hasVersions={false}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Version History' })).toBeNull()
  })

  it('renders autosave indicator states in the sidebar', () => {
    const { rerender } = render(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        autosave={{ status: 'saving' }}
      />,
    )
    expect(screen.getByText('Saving…')).toBeTruthy()

    rerender(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        autosave={{ status: 'saved', lastSavedAt: new Date() }}
      />,
    )
    expect(screen.getByText('Saved just now')).toBeTruthy()

    rerender(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        autosave={{ status: 'error', consecutiveErrors: 1 }}
      />,
    )
    expect(screen.getByText("Couldn't save, retrying…")).toBeTruthy()
  })

  it('renders Live Preview button when hasPreview is true and toggles on click', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        hasPreview={true}
        isPreviewOpen={false}
        onTogglePreview={onToggle}
      />,
    )

    const previewBtn = screen.getByRole('button', { name: 'Live Preview' })
    expect(previewBtn).toBeTruthy()
    previewBtn.click()
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(
      <DocumentSidebar
        mode="edit"
        submitLabel="Save Changes"
        isPending={false}
        hasPreview={true}
        isPreviewOpen={true}
        onTogglePreview={onToggle}
      />,
    )
    expect(screen.getByRole('button', { name: 'Hide Preview' })).toBeTruthy()
  })
})
