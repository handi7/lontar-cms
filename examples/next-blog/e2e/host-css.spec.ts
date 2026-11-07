import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'

// The admin renders inside someone else's page, and that page's global CSS is
// usually unlayered. An unlayered rule beats every rule in a cascade layer
// whatever its specificity, so if the admin's stylesheet ships its utilities or
// reset in a layer, a host reset like Tailwind v3's preflight strips its borders
// and button backgrounds (#143). This example gives the admin a root layout with
// no global CSS, so the host reset is loaded here instead.
const hostReset = fileURLToPath(new URL('./fixtures/host-reset.css', import.meta.url))

// What a host reset typically touches and a user would notice.
const PROPERTIES = [
  'background-color',
  'color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'margin-top',
  'margin-bottom',
  'padding-left',
  'padding-right',
  'list-style-type',
  'text-decoration-line',
] as const

async function computedStyles(page: Page): Promise<string[]> {
  return page.evaluate((properties) => {
    const elements = document.querySelectorAll('.lontar-admin, .lontar-admin *')
    return Array.from(elements, (element) => {
      const style = getComputedStyle(element)
      const values = properties.map(
        (property) => `${property}: ${style.getPropertyValue(property)}`,
      )
      const label = `${element.tagName.toLowerCase()} ${element.textContent?.trim().slice(0, 30) ?? ''}`
      return `${label} { ${values.join('; ')} }`
    })
  }, PROPERTIES)
}

test('host page CSS does not restyle the admin', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
    timeout: 15000,
  })

  const before = await computedStyles(page)
  // Appended last in <head>, so on a specificity tie the host rule wins: the
  // worst case for the admin.
  await page.addStyleTag({ path: hostReset })
  const after = await computedStyles(page)

  expect(after).toEqual(before)

  // Spot checks, so a failure names the symptom from #143 directly.
  const signIn = page.getByRole('button', { name: 'Sign In' })
  await expect(signIn).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('input[type="email"]')).toHaveCSS('border-top-width', '1px')
})
