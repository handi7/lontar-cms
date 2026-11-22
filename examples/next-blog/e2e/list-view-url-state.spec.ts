import { test, expect, type Page } from '@playwright/test'

// #214: the list view keeps page, search, filters and sort in the URL.
test.describe('List view state in the URL (#214)', () => {
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

  test('a filter survives opening a document and going back, and a reload', async ({ page }) => {
    await signIn(page)
    const title = `URL State Post ${Date.now()}`
    await createPost(page, title)

    // Apply a filter through the filter form (defaults to title / contains).
    await page.getByRole('button', { name: 'Add Filter' }).click()
    await page.getByLabel('Filter value').fill(title)
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('button', { name: /Remove title filter/ })).toBeVisible()
    await expect(page).toHaveURL(/filters=/)

    // Open the document, then go back: the filter is still applied.
    await page.getByRole('link', { name: title }).click()
    await expect(page.getByRole('heading', { name: /Edit Post/ })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Remove title filter/ })).toBeVisible()
    await expect(page.getByRole('link', { name: title })).toBeVisible()

    // A reload lands on the same view.
    await page.reload()
    await expect(page.getByRole('button', { name: /Remove title filter/ })).toBeVisible()
    await expect(page.getByRole('link', { name: title })).toBeVisible()

    // Clear all drops the filter from the URL.
    await page.getByRole('button', { name: 'Clear all' }).click()
    await expect(page).not.toHaveURL(/filters=/)
  })

  test('search and sort are shareable, and typing does not add history entries', async ({
    page,
  }) => {
    await signIn(page)
    const title = `URL Search Post ${Date.now()}`
    await createPost(page, title)

    await page.goto('/admin/posts')
    const search = page.getByRole('searchbox', { name: /search posts/i })
    await search.pressSequentially(title, { delay: 20 })
    await expect(page).toHaveURL(/q=/)
    await expect(page.getByRole('link', { name: title })).toBeVisible()

    // The keystrokes replaced one entry, so one Back leaves the list instead of undoing letters.
    await page.goBack()
    await expect(page).not.toHaveURL(/q=/)

    // A hand-edited URL with garbage is ignored rather than breaking the list.
    await page.goto(
      `/admin/posts?q=${encodeURIComponent(title)}&sort=-title&page=abc&filters=%5B%7B%22field%22%3A%22nope%22%7D%5D`,
    )
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(search).toHaveValue(title)
    await expect(page.getByRole('link', { name: title })).toBeVisible()
  })
})
