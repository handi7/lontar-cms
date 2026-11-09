import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AutosaveIndicator } from './AutosaveIndicator'

afterEach(cleanup)

describe('AutosaveIndicator', () => {
  it('renders nothing when status is idle', () => {
    const { container } = render(<AutosaveIndicator status="idle" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders "Saving…" when status is saving', () => {
    render(<AutosaveIndicator status="saving" />)
    expect(screen.getByText('Saving…')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('renders "Saved just now" initially when status is saved', () => {
    const savedAt = new Date()
    render(<AutosaveIndicator status="saved" lastSavedAt={savedAt} />)
    expect(screen.getByText('Saved just now')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('renders relative time "Saved 10s ago" after elapsed time', () => {
    const savedAt = new Date(Date.now() - 10000)
    render(<AutosaveIndicator status="saved" lastSavedAt={savedAt} />)
    expect(screen.getByText('Saved 10s ago')).toBeTruthy()
  })

  it('renders "Couldn\'t save, retrying…" on error', () => {
    render(<AutosaveIndicator status="error" consecutiveErrors={1} />)
    expect(screen.getByText("Couldn't save, retrying…")).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/Autosave failed/)).toBeNull()
  })

  it('escalates to an Alert when consecutiveErrors is 3 or more', () => {
    render(<AutosaveIndicator status="error" consecutiveErrors={3} />)
    expect(screen.getByText("Couldn't save, retrying…")).toBeTruthy()
    expect(
      screen.getByText('Autosave failed. Your changes are preserved locally in this form.'),
    ).toBeTruthy()
  })
})
