import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorPreviewToggle } from './EditorPreviewToggle'

describe('EditorPreviewToggle', () => {
  afterEach(cleanup)

  it('renders tablist with Edit and Preview tabs', () => {
    const onChange = vi.fn()
    render(<EditorPreviewToggle activeView="edit" onChange={onChange} />)

    const tablist = screen.getByRole('tablist', { name: 'Editor view' })
    expect(tablist).toBeTruthy()

    const editTab = screen.getByRole('tab', { name: 'Edit' })
    const previewTab = screen.getByRole('tab', { name: 'Preview' })

    expect(editTab.getAttribute('aria-selected')).toBe('true')
    expect(previewTab.getAttribute('aria-selected')).toBe('false')
  })

  it('reflects activeView="preview" correctly', () => {
    const onChange = vi.fn()
    render(<EditorPreviewToggle activeView="preview" onChange={onChange} />)

    const editTab = screen.getByRole('tab', { name: 'Edit' })
    const previewTab = screen.getByRole('tab', { name: 'Preview' })

    expect(editTab.getAttribute('aria-selected')).toBe('false')
    expect(previewTab.getAttribute('aria-selected')).toBe('true')
  })

  it('calls onChange with selected view when tabs are clicked', () => {
    const onChange = vi.fn()
    render(<EditorPreviewToggle activeView="edit" onChange={onChange} />)

    const previewTab = screen.getByRole('tab', { name: 'Preview' })
    fireEvent.click(previewTab)
    expect(onChange).toHaveBeenCalledWith('preview')

    const editTab = screen.getByRole('tab', { name: 'Edit' })
    fireEvent.click(editTab)
    expect(onChange).toHaveBeenCalledWith('edit')
  })
})
