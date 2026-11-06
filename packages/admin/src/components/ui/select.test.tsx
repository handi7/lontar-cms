import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PortalContainerProvider } from '../../context/PortalContainer'
import { chooseSelectOption } from '../../test/radix'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

function renderSelect(props: React.ComponentProps<typeof Select> = {}) {
  return render(
    <div className="lontar-admin">
      <PortalContainerProvider>
        <Select {...props}>
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

  it('selects an option with the mouse', () => {
    const onValueChange = vi.fn()
    renderSelect({ onValueChange })

    const trigger = screen.getByRole('combobox', { name: 'Status' })
    chooseSelectOption(trigger, 'Published')

    expect(onValueChange).toHaveBeenCalledWith('published')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.textContent).toBe('Published')
  })

  it('selects an option with the keyboard', () => {
    const onValueChange = vi.fn()
    renderSelect({ onValueChange })

    openSelect()
    fireEvent.keyDown(screen.getByRole('option', { name: 'Published' }), { key: 'Enter' })

    expect(onValueChange).toHaveBeenCalledWith('published')
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('Published')
  })

  it('submits the chosen value with a native form', () => {
    let submitted: Record<string, FormDataEntryValue> | undefined
    render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitted = Object.fromEntries(new FormData(event.currentTarget))
            }}
          >
            <Select name="status" defaultValue="draft">
              <SelectTrigger aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
              </SelectContent>
            </Select>
            <button type="submit">Save</button>
          </form>
        </PortalContainerProvider>
      </div>,
    )

    chooseSelectOption(screen.getByRole('combobox', { name: 'Status' }), 'Published')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(submitted).toEqual({ status: 'published' })
  })
})
