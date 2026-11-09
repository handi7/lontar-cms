import { test, expect } from '@playwright/test'
import { chooseOption, selectTrigger } from './helpers'

test.describe('Lontar CMS Admin in Next.js', () => {
  const adminEmail = 'admin@example.com'
  const adminPassword = 'password123'

  test.beforeAll(async ({ request }) => {
    // Ensure admin user exists via first-user onboarding endpoint
    const checkRes = await request.get('/api/_lontar/first-user')
    if (checkRes.ok()) {
      const { canRegisterFirstUser } = (await checkRes.json()) as { canRegisterFirstUser: boolean }
      if (canRegisterFirstUser) {
        await request.post('/api/_lontar/first-user', {
          data: {
            name: 'Admin User',
            email: adminEmail,
            password: adminPassword,
          },
        })
      }
    }
  })

  test('creates, displays, edits, and deletes a post', async ({ page }) => {
    // 1. Visit admin root - should redirect to login page
    await page.goto('/admin')

    // 2. Fill login form and submit
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()

    // 3. Wait for admin to mount and verify sidebar has Posts
    const postsLink = page.getByRole('link', { name: 'Posts', exact: true })
    await expect(postsLink).toBeVisible({ timeout: 15000 })
    await postsLink.click()

    // 4. Verify collection list view header
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()

    // 5. Click "Create Post" button
    const createButton = page.getByRole('link', { name: 'Create Post' }).first()
    await expect(createButton).toBeVisible()
    await createButton.click()

    // 6. Fill out form
    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()
    const uniqueTitle = `E2E Test Post ${Date.now()}`
    await page.locator('input[name="title"]').fill(uniqueTitle)

    // publishedAt should be hidden while status defaults to Draft
    await expect(page.locator('button[id="publishedAt"]')).not.toBeVisible()

    await chooseOption(page, /^status/i, 'Published')

    // publishedAt should mount reactively when status is Published
    await expect(page.locator('button[id="publishedAt"]')).toBeVisible()

    // 7. Submit form
    await page.getByRole('button', { name: 'Create Post' }).click()

    // 8. Verify back on posts list and new post appears in table
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: uniqueTitle })).toBeVisible()

    // 8a. Test search filter
    const searchInput = page.getByRole('searchbox', { name: /search posts/i })
    await searchInput.fill(uniqueTitle)
    await expect(page.getByRole('link', { name: uniqueTitle })).toBeVisible()
    await searchInput.fill('NonExistentTitleXYZ123')
    await expect(page.getByText('No documents found matching the filter criteria.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.getByRole('link', { name: uniqueTitle })).toBeVisible()

    // 8b. Test column header sorting
    const titleHeader = page.getByRole('columnheader', { name: /title/i })
    await titleHeader.click()
    await expect(page.getByRole('link', { name: uniqueTitle })).toBeVisible()

    // 9. Open edit view for the post
    await page.getByRole('link', { name: uniqueTitle }).click()
    await expect(page.getByRole('heading', { name: /Edit Post/ })).toBeVisible()
    await expect(page.locator('input[name="title"]')).toHaveValue(uniqueTitle)
    await expect(selectTrigger(page, /^status/i)).toHaveText('Published')

    // 10. Update the post
    const updatedTitle = `${uniqueTitle} (Updated)`
    await page.locator('input[name="title"]').fill(updatedTitle)
    await expect(page.locator('button[id="publishedAt"]')).toBeVisible()
    await chooseOption(page, /^status/i, 'Draft')
    await expect(page.locator('button[id="publishedAt"]')).not.toBeVisible()
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Saved successfully!')).toBeVisible()

    // 11. Return to list view via breadcrumbs and verify updated title
    await page.getByLabel('Breadcrumb').getByRole('link', { name: 'Posts' }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: updatedTitle })).toBeVisible()

    // 12. Delete the post
    // Deleting asks in an in-page dialog, not window.confirm (#136).
    await page.getByRole('button', { name: 'Delete' }).first().click()
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toContainText('Are you sure you want to delete this document?')
    await confirmDialog.getByRole('button', { name: 'Delete' }).click()

    // 13. Verify post is no longer in list
    await expect(page.getByRole('link', { name: updatedTitle })).not.toBeVisible()

    // 14. Verify user profile in sidebar and logout
    await expect(page.getByText(/Admin/)).toBeVisible()
    await expect(page.getByText(adminEmail)).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible()
  })

  // #140: the sidebar stays in view while the page scrolls, and its menu
  // scrolls on its own. Needs a real layout engine, which unit tests lack, so
  // it is checked here. At this height the dashboard is taller than the
  // viewport and the sidebar's menu does not fit either.
  test('keeps the sidebar in view with a scrollable menu on a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 360 })
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 15000,
    })

    const nav = page.locator('aside nav')
    const scrollsOnItsOwn = await nav.evaluate((el) => el.scrollHeight > el.clientHeight)
    expect(scrollsOnItsOwn).toBe(true)

    // Scroll the page to the bottom: the sidebar must not scroll away with it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect(page.getByRole('link', { name: 'Lontar CMS' })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeInViewport()
  })
})
