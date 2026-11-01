import { test, expect } from '@playwright/test'

test.describe('Lontar CMS Admin in Next.js', () => {
  const adminEmail = 'admin@example.com'
  const adminPassword = 'password123'

  test.beforeAll(async ({ request }) => {
    // Ensure admin user exists via Better Auth sign-up endpoint
    await request.post('/api/auth/sign-up/email', {
      data: {
        name: 'Admin User',
        email: adminEmail,
        password: adminPassword,
      },
    })
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
    await page.locator('input[name="views"]').fill('123')

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
    await expect(page.locator('input[name="views"]')).toHaveValue('123')

    // 10. Update the post
    const updatedTitle = `${uniqueTitle} (Updated)`
    await page.locator('input[name="title"]').fill(updatedTitle)
    await page.locator('input[name="views"]').fill('456')
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Saved successfully!')).toBeVisible()

    // 11. Return to list view and verify updated title
    await page.getByRole('link', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: updatedTitle })).toBeVisible()

    // 12. Delete the post
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete' }).first().click()

    // 13. Verify post is no longer in list
    await expect(page.getByRole('link', { name: updatedTitle })).not.toBeVisible()

    // 14. Verify user profile in sidebar and logout
    await expect(page.getByText('Admin User')).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible()
  })
})
