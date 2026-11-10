import { test, expect } from '@playwright/test'

test.describe('Next.js Blog M8: Drafts, Live Preview and Revalidation', () => {
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

  test('full draft, live preview, publish, revalidate and unpublish lifecycle for posts', async ({
    page,
    browser,
  }) => {
    const id = Date.now()
    const draftTitle = `Upcoming Architecture Insights ${id}`
    const postSlug = `upcoming-architecture-insights-${id}`
    const authorName = `Preview Author ${id}`

    // -------------------------------------------------------------
    // 1. Log in to the Admin Panel as an editor
    // -------------------------------------------------------------
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()

    await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 15000,
    })

    // -------------------------------------------------------------
    // 1b. Create an Author to verify populated relation in preview
    // -------------------------------------------------------------
    await page.getByRole('link', { name: 'Authors', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Authors', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Author' }).first().click()
    await expect(page.getByRole('heading', { name: 'Create Author' })).toBeVisible()
    await page.locator('input[name="name"]').fill(authorName)
    await page.locator('textarea[name="bio"]').fill('Author bio for live preview verification.')
    await page.getByRole('button', { name: 'Create Author' }).click()
    await expect(page.getByRole('heading', { name: 'Authors', exact: true })).toBeVisible()

    // -------------------------------------------------------------
    // 2. Create a Post as a Draft (do not publish yet)
    // -------------------------------------------------------------
    await page.getByRole('link', { name: 'Posts', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Post' }).first().click()

    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()
    await page.locator('input[name="title"]').fill(draftTitle)

    // Select Author
    const authorSearchInput = page.locator('input[data-testid="relationship-search"]').first()
    await authorSearchInput.fill(authorName)
    const authorOption = page.getByRole('button', { name: new RegExp(authorName, 'i') }).first()
    await expect(authorOption).toBeVisible()
    await authorOption.click()

    // Fill rich text
    const richTextEditor = page.locator('.ProseMirror')
    await richTextEditor.click()
    await richTextEditor.fill('Draft content describing upcoming architecture redesigns.')

    // Save as draft via the split button dropdown
    await page.getByRole('button', { name: 'Publishing options' }).click()
    const saveDraftBtn = page.getByRole('menuitem', { name: 'Save Draft' })
    await expect(saveDraftBtn).toBeVisible()
    await saveDraftBtn.click()

    // Navigates back to posts list
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    const postLink = page.getByRole('link', { name: draftTitle })
    await expect(postLink).toBeVisible()

    // Verify row status shows Draft
    const postRow = page.locator('tr', { hasText: draftTitle })
    await expect(postRow).toContainText('Draft')

    // -------------------------------------------------------------
    // 3. Verify Public Site (Unauthenticated Visitor)
    // -------------------------------------------------------------
    const publicContext = await browser.newContext()
    const publicPage = await publicContext.newPage()

    // 3a. Homepage should not list the draft post
    await publicPage.goto('/')
    await expect(publicPage.locator('article', { hasText: draftTitle })).not.toBeVisible()

    // 3b. Direct post detail without preview param should return 404
    const directRes = await publicPage.goto(`/posts/${postSlug}`)
    expect(directRes?.status()).toBe(404)

    // 3c. Direct post detail WITH preview param should STILL return 404 for unauthenticated visitor
    const unauthPreviewRes = await publicPage.goto(`/posts/${postSlug}?preview=1`)
    expect(unauthPreviewRes?.status()).toBe(404)

    // -------------------------------------------------------------
    // 4. Verify Preview Route for Authenticated Editor
    // -------------------------------------------------------------
    // In the editor's page (authenticated), visit preview URL
    await page.goto(`/posts/${postSlug}?preview=1`)
    await expect(page.locator('[data-testid="post-title"]')).toHaveText(draftTitle)
    await expect(page.locator('[data-testid="preview-badge"]')).toBeVisible()
    await expect(page.locator('[data-testid="post-content"]')).toContainText(
      'Draft content describing upcoming architecture redesigns.',
    )

    // -------------------------------------------------------------
    // 5. Open Post in Admin and Test Live Preview Pane
    // -------------------------------------------------------------
    await page.goto('/admin/posts')
    await page.getByRole('link', { name: draftTitle }).click()
    await expect(page.getByRole('heading', { name: /Edit Post/ })).toBeVisible()

    // Status badge in document sidebar should be Draft
    await expect(page.locator('aside').getByText('Draft', { exact: true })).toBeVisible()

    // Toggle Live Preview
    const livePreviewBtn = page.getByRole('button', { name: 'Live Preview' })
    await expect(livePreviewBtn).toBeVisible()
    await livePreviewBtn.click()

    // Live preview pane renders an iframe
    const previewFrame = page.frameLocator('iframe[title="Live Preview"]')
    await expect(previewFrame.locator('[data-testid="post-title"]')).toHaveText(draftTitle, {
      timeout: 10000,
    })
    await expect(previewFrame.locator('[data-testid="preview-badge"]')).toBeVisible()
    await expect(previewFrame.locator('[data-testid="post-author"]')).toContainText(authorName)

    // Update title in editor -> updates live in preview pane over postMessage
    const updatedDraftTitle = `${draftTitle} [Live Edit]`
    await page.locator('input[name="title"]').fill(updatedDraftTitle)
    await expect(previewFrame.locator('[data-testid="post-title"]')).toHaveText(updatedDraftTitle, {
      timeout: 5000,
    })
    // Relational author continues to render after typing in live preview
    await expect(previewFrame.locator('[data-testid="post-author"]')).toContainText(authorName)

    // -------------------------------------------------------------
    // 6. Publish the Post
    // -------------------------------------------------------------
    const publishBtn = page.getByRole('button', { name: 'Publish', exact: true })
    await expect(publishBtn).toBeVisible()
    await publishBtn.click()

    // Success alert and status badge update to Published
    await expect(page.getByText('Published successfully!')).toBeVisible()
    await expect(page.locator('aside').getByText('Published', { exact: true })).toBeVisible()

    // -------------------------------------------------------------
    // 7. Verify Public Site (Now Visible via Revalidation)
    // -------------------------------------------------------------
    // The webhook revalidates on publish
    await publicPage.goto('/')
    const publishedCard = publicPage.locator('article', { hasText: updatedDraftTitle })
    await expect(publishedCard).toBeVisible()

    await publicPage.goto(`/posts/${postSlug}`)
    await expect(publicPage.locator('[data-testid="post-title"]')).toHaveText(updatedDraftTitle)
    // Public view has no draft preview badge
    await expect(publicPage.locator('[data-testid="preview-badge"]')).not.toBeVisible()

    // -------------------------------------------------------------
    // 8. Unpublish the Post
    // -------------------------------------------------------------
    await page.getByRole('button', { name: 'Publishing options' }).click()
    const unpublishMenuItem = page.getByRole('menuitem', { name: 'Unpublish' })
    await expect(unpublishMenuItem).toBeVisible()
    await unpublishMenuItem.click()

    await expect(page.getByText('Unpublished successfully!')).toBeVisible()
    await expect(page.locator('aside').getByText('Draft', { exact: true })).toBeVisible()

    // -------------------------------------------------------------
    // 9. Verify Public Site After Unpublish
    // -------------------------------------------------------------
    await publicPage.goto('/')
    await expect(publicPage.locator('article', { hasText: updatedDraftTitle })).not.toBeVisible()

    const unpubRes = await publicPage.goto(`/posts/${postSlug}`)
    expect(unpubRes?.status()).toBe(404)

    await publicContext.close()
  })

  test('draft and preview lifecycle for pages collection', async ({ page, browser }) => {
    const id = Date.now()
    const draftPageTitle = `Enterprise Solutions ${id}`
    const pageSlug = `enterprise-solutions-${id}`

    // 1. Log in to admin
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('link', { name: 'Pages', exact: true })).toBeVisible({
      timeout: 15000,
    })

    // 2. Create Page draft
    await page.getByRole('link', { name: 'Pages', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Page' }).first().click()

    await expect(page.getByRole('heading', { name: 'Create Page' })).toBeVisible()
    await page.locator('input[name="title"]').fill(draftPageTitle)
    await page.locator('input[name="slug"]').fill(pageSlug)

    // Save as draft
    await page.getByRole('button', { name: 'Publishing options' }).click()
    await page.getByRole('menuitem', { name: 'Save Draft' }).click()

    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: draftPageTitle })).toBeVisible()

    // 3. Unauthenticated visitor gets 404
    const publicContext = await browser.newContext()
    const publicPage = await publicContext.newPage()

    const directRes = await publicPage.goto(`/${pageSlug}`)
    expect(directRes?.status()).toBe(404)

    const unauthPreviewRes = await publicPage.goto(`/${pageSlug}?preview=1`)
    expect(unauthPreviewRes?.status()).toBe(404)

    // 4. Authenticated editor sees draft preview
    await page.goto(`/${pageSlug}?preview=1`)
    await expect(page.locator('[data-testid="page-title"]')).toHaveText(draftPageTitle)
    await expect(page.locator('[data-testid="preview-badge"]')).toBeVisible()

    // 5. Publish page in admin
    await page.goto('/admin/pages')
    await page.getByRole('link', { name: draftPageTitle }).click()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByText('Published successfully!')).toBeVisible()

    // 6. Public visitor now sees published page
    await publicPage.goto(`/${pageSlug}`)
    await expect(publicPage.locator('[data-testid="page-title"]')).toHaveText(draftPageTitle)
    await expect(publicPage.locator('[data-testid="preview-badge"]')).not.toBeVisible()

    await publicContext.close()
  })
})
