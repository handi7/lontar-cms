import { test, expect } from '@playwright/test'

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

    // 7. Submit form via Publish button (drafts-enabled collection)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()

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
    await searchInput.fill(uniqueTitle)
    const titleHeader = page.getByRole('columnheader', { name: /title/i })
    await titleHeader.click()
    await expect(page.getByRole('link', { name: uniqueTitle })).toBeVisible()

    // 9. Open edit view for the post
    await page.getByRole('link', { name: uniqueTitle }).click()
    await expect(page.getByRole('heading', { name: /Edit Post/ })).toBeVisible()
    await expect(page.locator('input[name="title"]')).toHaveValue(uniqueTitle)

    // 10. Update the post
    const updatedTitle = `${uniqueTitle} (Updated)`
    await page.locator('input[name="title"]').fill(updatedTitle)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByText('Published successfully!')).toBeVisible()

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
    const accountLink = page.getByRole('link', { name: 'Account settings' })
    await expect(accountLink).toBeVisible()
    await expect(accountLink).toContainText(adminEmail)
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

  test('manages users and updates account settings (#343)', async ({ page }) => {
    // 1. Visit admin root and log in
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()

    // 2. Wait for admin mount and verify sidebar has Users link under Administration
    const usersLink = page.getByRole('link', { name: 'Users', exact: true })
    await expect(usersLink).toBeVisible({ timeout: 15000 })
    await usersLink.click()

    // 3. Verify Users view is displayed
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
    await expect(page.getByRole('table').getByText(adminEmail)).toBeVisible()

    // 4. Create new user
    await page.getByRole('button', { name: 'New user' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Create new user')).toBeVisible()

    const newEmail = `editor-${Date.now()}@example.com`
    await dialog.locator('#create-user-name').fill('Editor E2E')
    await dialog.locator('#create-user-email').fill(newEmail)
    await dialog.locator('#create-user-password').fill('editorpass123')
    await dialog.getByRole('button', { name: 'Create user' }).click()

    // 5. Verify new user appears in table
    await expect(page.getByText(newEmail)).toBeVisible()
    await expect(page.getByText('User created successfully.')).toBeVisible()

    // 6. Navigate to account page via sidebar user profile
    const accountLink = page.getByRole('link', { name: 'Account settings' })
    await expect(accountLink).toBeVisible()
    await accountLink.click()

    // 7. Verify Account view is displayed
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible()
    await expect(page.locator('#account-email')).toHaveValue(adminEmail)

    // 8. Update display name
    const updatedName = `Admin Updated ${Date.now()}`
    await page.locator('#account-name').fill(updatedName)
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(page.getByText('Profile name updated successfully.')).toBeVisible()

    // Restore original name
    await page.locator('#account-name').fill('Admin User')
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(page.getByText('Profile name updated successfully.')).toBeVisible()
  })
})
