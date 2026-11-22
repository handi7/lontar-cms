import { test, expect, type Page } from '@playwright/test'

// #215: a ⌘K / Ctrl+K command palette to jump to a collection or global, or start a new document.
test.describe('Command palette (#215)', () => {
  const adminEmail = 'admin@example.com'
  const adminPassword = 'password123'

  test.beforeAll(async ({ request }) => {
    const checkRes = await request.get('/api/_lontar/first-user')
    if (checkRes.ok()) {
      const { canRegisterFirstUser } = (await checkRes.json()) as { canRegisterFirstUser: boolean }
      if (canRegisterFirstUser) {
        await request.post('/api/_lontar/first-user', {
          data: { name: 'Admin User', email: adminEmail, password: adminPassword },
        })
      }
    }
  })

  async function signIn(page: Page) {
    await page.goto('/admin/login')
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 15000,
    })
  }

  test('opens with the keyboard, filters, and goes to the chosen entry', async ({ page }) => {
    await signIn(page)
    const palette = page.getByRole('dialog', { name: 'Command palette' })

    await page.keyboard.press('Control+K')
    await expect(palette).toBeVisible()
    await expect(palette.getByText('Go to Posts')).toBeVisible()

    await palette.getByRole('combobox').fill('new post')
    await expect(palette.getByText('Go to Posts')).toBeHidden()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/admin\/posts\/create/)
    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()
    await expect(palette).toBeHidden()
  })

  test('opens from the sidebar button, closes with Escape, and reaches a collection', async ({
    page,
  }) => {
    await signIn(page)
    const palette = page.getByRole('dialog', { name: 'Command palette' })

    await page.locator('aside').getByRole('button', { name: 'Open command palette' }).click()
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()

    await page.keyboard.press('Control+K')
    await palette.getByRole('combobox').fill('posts')
    await palette.getByText('Go to Posts').click()
    await expect(page).toHaveURL(/\/admin\/posts$/)
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
  })

  test('is reachable from the drawer on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin/login')
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await page.getByRole('button', { name: 'Open navigation' }).click({ timeout: 15000 })

    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('button', { name: 'Open command palette' })
      .click()

    // The drawer gives way to the palette instead of stacking behind it.
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden()
  })
})
