import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PortalContainerProvider } from '@/context/PortalContainer'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

function renderSelect() {
  return render(
    <div className="lontar-admin">
      <PortalContainerProvider>
        <Select>
          <SelectTrigger aria-label="Status">
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
      </PortalContainerProvider>
    </div>,
  )
}

function openSelect() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Status' }), { key: 'ArrowDown' })
}

describe('Select', () => {
  afterEach(cleanup)

  it('renders the trigger with its placeholder', () => {
    renderSelect()
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy()
    expect(screen.getByText('Pick one')).toBeTruthy()
  })

  it('keeps the opened content inside the .lontar-admin wrapper', () => {
    renderSelect()
    openSelect()

    const item = screen.getByText('Draft')
    expect(item.closest('.lontar-admin')).not.toBeNull()
  })

  it('portals into the provider target, not document.body', () => {
    renderSelect()
    openSelect()

    const target = document.querySelector('.lontar-portal-root')
    expect(target).not.toBeNull()
    expect(target?.contains(screen.getByText('Draft'))).toBe(true)

    const options = Array.from(document.querySelectorAll('[role="option"]'))
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.closest('.lontar-admin')).not.toBeNull()
    }
  })

  it('throws instead of portalling to document.body without a provider', () => {
    // The provider is deliberately absent, so usePortalContainer throws rather
    // than silently portalling to document.body.
    expect(() =>
      render(
        <Select open>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>,
      ),
    ).toThrow('usePortalContainer must be used within a PortalContainerProvider')
  })
})
