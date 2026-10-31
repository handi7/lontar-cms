import { test, expect } from '@playwright/test'

test.describe('Lontar CMS Admin in Next.js', () => {
  test('creates, displays, edits, and deletes a post', async ({ page }) => {
    // 1. Visit admin root
    await page.goto('/admin')

    // 2. Wait for admin to mount and verify sidebar has Posts
    const postsLink = page.getByRole('link', { name: 'Posts', exact: true })
    await expect(postsLink).toBeVisible({ timeout: 15000 })
    await postsLink.click()

    // 3. Verify collection list view header
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()

    // 4. Click "Create Post" button
    const createButton = page.getByRole('link', { name: 'Create Post' }).first()
    await expect(createButton).toBeVisible()
    await createButton.click()

    // 5. Fill out form
    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()
    const uniqueTitle = `E2E Test Post ${Date.now()}`
    await page.locator('input[name="title"]').fill(uniqueTitle)
    await page.locator('input[name="views"]').fill('123')

    // 6. Submit form
    await page.getByRole('button', { name: 'Create Post' }).click()

    // 7. Verify back on posts list and new post appears in table
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: uniqueTitle })).toBeVisible()

    // 8. Open edit view for the post
    await page.getByRole('link', { name: uniqueTitle }).click()
    await expect(page.getByRole('heading', { name: /Edit Post/ })).toBeVisible()
    await expect(page.locator('input[name="title"]')).toHaveValue(uniqueTitle)
    await expect(page.locator('input[name="views"]')).toHaveValue('123')

    // 9. Update the post
    const updatedTitle = `${uniqueTitle} (Updated)`
    await page.locator('input[name="title"]').fill(updatedTitle)
    await page.locator('input[name="views"]').fill('456')
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Saved successfully!')).toBeVisible()

    // 10. Return to list view and verify updated title
    await page.getByRole('link', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: updatedTitle })).toBeVisible()

    // 11. Delete the post
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete' }).first().click()

    // 12. Verify post is no longer in list
    await expect(page.getByRole('link', { name: updatedTitle })).not.toBeVisible()
  })
})
