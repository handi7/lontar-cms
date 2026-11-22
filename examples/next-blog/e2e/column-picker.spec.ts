import { test, expect } from '@playwright/test'

// #461: the list view column picker, remembered per user in localStorage.
test.describe('List view column picker (#461)', () => {
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

  test('shows a chosen column, keeps it after a reload, and resets to the default', async ({
    page,
  }) => {
    await page.goto('/admin/login')
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 15000,
    })

    await page.goto('/admin/posts')
    const updatedAt = page.getByRole('columnheader', { name: /Updated At/ })
    await expect(page.getByRole('columnheader', { name: /Title/ })).toBeVisible()
    await expect(updatedAt).toBeHidden()

    await page.getByRole('button', { name: 'Columns' }).click()
    // The title column is how a row is recognised, so it cannot be turned off.
    await expect(page.getByRole('checkbox', { name: /Title/ })).toBeDisabled()
    await page.getByRole('checkbox', { name: 'Updated At' }).click()
    await expect(updatedAt).toBeVisible()

    await page.reload()
    await expect(updatedAt).toBeVisible()

    await page.getByRole('button', { name: 'Columns' }).click()
    await page.getByRole('button', { name: 'Reset to default' }).click()
    await expect(updatedAt).toBeHidden()

    await page.reload()
    await expect(page.getByRole('columnheader', { name: /Title/ })).toBeVisible()
    await expect(updatedAt).toBeHidden()
  })
})
