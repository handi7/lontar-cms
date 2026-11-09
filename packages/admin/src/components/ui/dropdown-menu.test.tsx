import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PortalContainerProvider } from '../../context/PortalContainer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

function renderDropdown() {
  return render(
    <div className="lontar-admin">
      <PortalContainerProvider>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">Actions</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Save draft</DropdownMenuItem>
            <DropdownMenuItem>Unpublish</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PortalContainerProvider>
    </div>,
  )
}

describe('DropdownMenu', () => {
  afterEach(cleanup)

  it('renders trigger button', () => {
    renderDropdown()
    expect(screen.getByRole('button', { name: 'Actions' })).toBeTruthy()
  })

  it('portals content into the provider container on open', () => {
    renderDropdown()
    const trigger = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })

    const item = screen.getByText('Save draft')
    expect(item).toBeTruthy()
    expect(item.closest('.lontar-portal-root')).not.toBeNull()
    expect(item.closest('.lontar-admin')).not.toBeNull()
  })
})
