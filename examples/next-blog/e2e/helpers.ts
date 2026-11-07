import type { Locator, Page } from '@playwright/test'

/**
 * The admin's select fields are Radix Selects: a combobox button and a listbox
 * portalled into the admin wrapper, not a native <select>. `selectOption()` and
 * `toHaveValue()` only work on a native one, so the field is driven the way a
 * user drives it, and its value is read from the trigger's text.
 */
export function selectTrigger(page: Page, label: RegExp): Locator {
  return page.getByRole('combobox', { name: label })
}

export async function chooseOption(page: Page, label: RegExp, option: string): Promise<void> {
  await selectTrigger(page, label).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
