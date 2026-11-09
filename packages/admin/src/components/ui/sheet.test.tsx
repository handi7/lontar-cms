import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PortalContainerProvider } from '../../context/PortalContainer'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet'

afterEach(cleanup)

function renderSheet(defaultOpen = false) {
  return render(
    <div className="lontar-admin">
      <PortalContainerProvider>
        <Sheet defaultOpen={defaultOpen}>
          <SheetTrigger asChild>
            <button type="button">Open History</button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Version History</SheetTitle>
              <SheetDescription>Compare and restore snapshots.</SheetDescription>
            </SheetHeader>
            <div>Sheet body content</div>
            <SheetClose asChild>
              <button type="button">Dismiss</button>
            </SheetClose>
          </SheetContent>
        </Sheet>
      </PortalContainerProvider>
    </div>,
  )
}

describe('Sheet', () => {
  it('renders trigger button', () => {
    renderSheet(false)
    expect(screen.getByRole('button', { name: 'Open History' })).toBeTruthy()
    expect(screen.queryByText('Version History')).toBeNull()
  })

  it('portals content into the provider container on open', () => {
    renderSheet(false)
    fireEvent.click(screen.getByRole('button', { name: 'Open History' }))

    const title = screen.getByText('Version History')
    expect(title).toBeTruthy()
    expect(title.closest('.lontar-portal-root')).not.toBeNull()
    expect(title.closest('.lontar-admin')).not.toBeNull()
    expect(screen.getByText('Compare and restore snapshots.')).toBeTruthy()
    expect(screen.getByText('Sheet body content')).toBeTruthy()
  })

  it('closes when clicking the close button', () => {
    renderSheet(true)
    expect(screen.getByText('Version History')).toBeTruthy()

    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' })
    fireEvent.click(dismissBtn)

    expect(screen.queryByText('Version History')).toBeNull()
  })
})
