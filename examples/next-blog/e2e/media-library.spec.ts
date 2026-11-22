import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// #462: a grid with previews, a file type filter and a detail panel for upload collections.
test.describe('Media library (#462)', () => {
  const adminEmail = 'admin@example.com'
  const adminPassword = 'password123'
  const testImagePath = path.join(__dirname, 'fixtures', 'test-image.png')

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

  test('filters to images, opens a file from the grid, and remembers the grid', async ({
    page,
  }) => {
    await page.goto('/admin/login')
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 15000,
    })

    // Make sure there is an image to find.
    await page.goto('/admin/media/create')
    await page.locator('input[type="file"]').setInputFiles(testImagePath)
    await page.locator('input[name="alt"]').fill(`Library test ${Date.now()}`)
    await page.getByRole('button', { name: 'Create Media' }).click()
    await expect(page.getByRole('heading', { name: 'Media', exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Grid/ }).click()
    const tiles = page.getByRole('list', { name: 'Media' }).getByRole('listitem')
    await expect(tiles.first()).toBeVisible()

    await page.getByRole('button', { name: 'Documents' }).click()
    await expect(page).toHaveURL(/mime=documents/)
    await expect(tiles.first()).toBeHidden()

    await page.getByRole('button', { name: 'Images' }).click()
    await expect(page).toHaveURL(/mime=images/)
    await expect(tiles.first().locator('img')).toBeVisible()

    await tiles.first().getByRole('button').click()
    const panel = page.getByRole('dialog')
    await expect(panel.getByText('image/png')).toBeVisible()
    await expect(panel.getByRole('img')).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Edit' })).toBeVisible()
    await panel.getByRole('button', { name: 'Close' }).click()
    await expect(panel).toBeHidden()

    await page.reload()
    await expect(page.getByRole('list', { name: 'Media' })).toBeVisible()
  })
})
