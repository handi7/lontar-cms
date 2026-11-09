import { fireEvent, screen } from '@testing-library/react'

/**
 * Opens a Radix Select and picks an option the way a mouse does.
 *
 * Two things make a single `fireEvent.click` insufficient:
 *
 * - The trigger opens on `pointerdown` (primary button, mouse pointer), not on
 *   `click`.
 * - While the content is open, Radix swallows the first `pointerup` that lands
 *   within 10px of where the trigger was pressed, so the release of the click
 *   that opened it cannot also select an item. `fireEvent` events carry no
 *   coordinates, so every synthetic pointerup is "within 10px". The trigger's
 *   own release is sent first to spend that guard, as a real mouse would.
 *
 * Items select on `pointerup` for a mouse and on `click` for touch and pen, so
 * the item's pointerdown must say `mouse` too.
 */
export function chooseSelectOption(trigger: HTMLElement, option: string | RegExp): void {
  const mouse = { button: 0, ctrlKey: false, pointerType: 'mouse' }

  fireEvent.pointerDown(trigger, mouse)
  fireEvent.pointerUp(trigger, mouse)

  const item = screen.getByRole('option', { name: option })
  fireEvent.pointerDown(item, mouse)
  fireEvent.pointerUp(item, mouse)
}

export function openDropdownMenu(trigger: HTMLElement): void {
  const mouse = { button: 0, ctrlKey: false, pointerType: 'mouse' }
  fireEvent.pointerDown(trigger, mouse)
  fireEvent.pointerUp(trigger, mouse)
}

export function chooseDropdownMenuItem(trigger: HTMLElement, itemText: string | RegExp): void {
  openDropdownMenu(trigger)
  const item = screen.getByText(itemText)
  fireEvent.click(item)
}
