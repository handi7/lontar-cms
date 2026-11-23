import { test, expect, type Page } from '@playwright/test'

test.describe('Extensibility (#471)', () => {
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

  test('dashboard widget displays pending posts count from custom endpoint (#464, #466)', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/admin')
    const widget = page.getByTestId('pending-posts-widget')
    await expect(widget).toBeVisible()

    const initialText = await page.getByTestId('pending-posts-count').textContent()
    const initialCount = Number(initialText?.trim() || '0')

    // Create a new draft post
    await page.goto('/admin/posts/create')
    await page.locator('input[name="title"]').fill(`Draft Post ${Date.now()}`)
    await page.getByRole('button', { name: 'Save Draft' }).click()
    await expect(page.getByText('Saved draft', { exact: false })).toBeVisible()

    // Return to dashboard and verify the pending posts count has increased
    await page.goto('/admin')
    await expect(widget).toBeVisible()
    await expect(page.getByTestId('pending-posts-count')).toHaveText(String(initialCount + 1))
  })

  test('custom view with sidebar entry is navigable and rendered (#467)', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin')

    const sidebar = page.locator('aside')
    const analyticsLink = sidebar.getByRole('link', { name: 'Analytics', exact: true })
    await expect(analyticsLink).toBeVisible()
    await analyticsLink.click()

    await expect(page).toHaveURL(/\/admin\/views\/analytics/)
    await expect(page.getByTestId('custom-view-analytics')).toBeVisible()
    await expect(page.getByTestId('analytics-view')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible()
  })

  test('custom field input renders star rating and saves value (#465)', async ({ page }) => {
    await signIn(page)
    const title = `Rated Post ${Date.now()}`
    await page.goto('/admin/posts/create')
    await page.locator('input[name="title"]').fill(title)

    const starRating = page.getByTestId('star-rating')
    await expect(starRating).toBeVisible()

    // Click 4 stars
    await starRating.getByRole('button', { name: '4 stars' }).click()
    await expect(page.getByTestId('star-rating-value')).toHaveText('4/5')

    // Publish document
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('link', { name: title })).toBeVisible()

    // Reload edit view to verify rating persisted
    await page.reload()
    await expect(page.getByTestId('star-rating-value')).toHaveText('4/5')
  })

  test('declarative row action and document action archive post (#468)', async ({ page }) => {
    await signIn(page)
    const title = `Post to Archive ${Date.now()}`
    await page.goto('/admin/posts/create')
    await page.locator('input[name="title"]').fill(title)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('link', { name: title })).toBeVisible()

    // Document sidebar action check: in edit mode, Archive action button should be visible in sidebar
    const docArchiveBtn = page.getByRole('button', { name: 'Archive', exact: true })
    await expect(docArchiveBtn).toBeVisible()

    // Go to list view, search for post
    await page.goto(`/admin/posts?q=${encodeURIComponent(title)}`)
    const row = page.getByRole('row', { name: new RegExp(title, 'i') })
    await expect(row).toBeVisible()
    await expect(row.getByText('Published')).toBeVisible()

    // Open row action menu
    await row.getByRole('button', { name: `Actions for ${title}` }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()

    // Confirm dialog
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Archive this post?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Archive' }).click()

    // Post transitions to draft
    await expect(row.getByText('Draft')).toBeVisible()
  })

  test('declarative bulk action archives selected posts (#469)', async ({ page }) => {
    await signIn(page)
    const prefix = `Bulk Archive ${Date.now()}`
    const post1 = `${prefix} 1`
    const post2 = `${prefix} 2`

    // Create two published posts
    await page.goto('/admin/posts/create')
    await page.locator('input[name="title"]').fill(post1)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('link', { name: post1 })).toBeVisible()

    await page.goto('/admin/posts/create')
    await page.locator('input[name="title"]').fill(post2)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('link', { name: post2 })).toBeVisible()

    // Go to list view filtered to these posts
    await page.goto(`/admin/posts?q=${encodeURIComponent(prefix)}`)
    const row1 = page.getByRole('row', { name: new RegExp(post1, 'i') })
    const row2 = page.getByRole('row', { name: new RegExp(post2, 'i') })
    await expect(row1).toBeVisible()
    await expect(row2).toBeVisible()
    await expect(row1.getByText('Published')).toBeVisible()
    await expect(row2.getByText('Published')).toBeVisible()

    // Select both
    await page.getByLabel(`Select ${post1}`).click()
    await page.getByLabel(`Select ${post2}`).click()

    // Bulk bar should show custom "Archive" action
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await expect(bar).toBeVisible()
    const bulkArchiveBtn = bar.getByRole('button', { name: 'Archive', exact: true })
    await expect(bulkArchiveBtn).toBeVisible()
    await bulkArchiveBtn.click()

    // Confirm dialog with {count} replaced
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Archive 2 selected posts?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Archive' }).click()

    // Both posts transition to draft
    await expect(row1.getByText('Draft')).toBeVisible()
    await expect(row2.getByText('Draft')).toBeVisible()
  })
})
