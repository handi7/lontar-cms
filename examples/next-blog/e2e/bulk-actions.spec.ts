import { test, expect, type Page } from '@playwright/test'

// #460: row selection in the list view with bulk delete and publish/unpublish.
test.describe('List view bulk actions (#460)', () => {
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

  async function createPost(page: Page, title: string) {
    await page.goto('/admin/posts/create')
    await page.locator('input[name="title"]').fill(title)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('link', { name: title })).toBeVisible()
  }

  test('selects two documents, unpublishes them, then deletes them', async ({ page }) => {
    await signIn(page)
    const prefix = `Bulk ${Date.now()}`
    const first = `${prefix} A`
    const second = `${prefix} B`
    await createPost(page, first)
    await createPost(page, second)

    // Narrow the list to these two documents.
    await page.goto(`/admin/posts?q=${encodeURIComponent(prefix)}`)
    await expect(page.getByRole('link', { name: first })).toBeVisible()
    await expect(page.getByRole('link', { name: second })).toBeVisible()

    // Nothing is selected, so there is no bar.
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await expect(bar).toBeHidden()

    await page.getByLabel(`Select ${first}`).click()
    await page.getByLabel(`Select ${second}`).click()
    await expect(bar.getByTestId('bulk-count')).toHaveText('2 selected')

    // Unpublish both: the summary reports it and the selection stays for the next action.
    await bar.getByRole('button', { name: 'Unpublish' }).click()
    await expect(page.getByTestId('bulk-summary')).toContainText('Unpublished 2 documents.')

    // Changing the search clears the selection.
    await page.getByRole('searchbox', { name: /search posts/i }).fill(first)
    await expect(bar).toBeHidden()
    await expect(page.getByRole('link', { name: second })).toBeHidden()

    // Back to both, select the whole page and delete.
    await page.getByRole('searchbox', { name: /search posts/i }).fill(prefix)
    await expect(page.getByRole('link', { name: second })).toBeVisible()
    await page.getByLabel('Select all on this page').click()
    await expect(bar.getByTestId('bulk-count')).toHaveText('2 selected')
    await bar.getByRole('button', { name: 'Delete' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Delete 2 documents')
    await dialog.getByRole('button', { name: 'Delete 2' }).click()

    await expect(page.getByTestId('bulk-summary')).toContainText('Deleted 2 documents.')
    await expect(page.getByRole('link', { name: first })).toBeHidden()
    await expect(page.getByRole('link', { name: second })).toBeHidden()
    await expect(bar).toBeHidden()
  })
})
