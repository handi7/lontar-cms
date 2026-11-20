import { test, expect } from '@playwright/test'

test.describe('Two-Locale Next.js Blog End-to-End (#431)', () => {
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

  test('full localization flow: create in en, translate to id, publish, see both on frontend, test fallback, and preview id draft while en stays live', async ({
    page,
    browser,
  }) => {
    const id = Date.now()
    const enTitle = `Global Architecture Insights ${id}`
    const enExcerpt = `An in-depth look into globally distributed systems ${id}`
    const idTitle = `Arsitektur Sistem Global ${id}`
    const idExcerpt = `Tinjauan mendalam tentang sistem terdistribusi global ${id}`

    // -------------------------------------------------------------
    // 1. Log in to the Admin Panel as admin
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
    // 2. Create Post in English (default locale) and Publish
    // -------------------------------------------------------------
    await page.getByRole('link', { name: 'Posts', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Post' }).first().click()

    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()

    // Verify Locale Switcher in edit form indicates English
    const switcher = page.getByTestId('locale-switcher')
    await expect(switcher).toBeVisible({ timeout: 15000 })
    await expect(switcher).toContainText('English (en)')

    // Fill English fields
    await page.locator('input[name="title"]').fill(enTitle)
    await page.locator('textarea[name="excerpt"]').fill(enExcerpt)

    const richTextEditor = page.locator('.ProseMirror')
    await richTextEditor.click()
    await richTextEditor.fill(
      'English article body detailing cloud architecture and edge deployment.',
    )

    // Publish the post in English
    const publishBtn = page.getByRole('button', { name: 'Publish', exact: true })
    await publishBtn.click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()

    // -------------------------------------------------------------
    // 3. Switch Locale to Indonesian (id), Translate and Publish
    // -------------------------------------------------------------
    await page.getByRole('link', { name: enTitle }).click()
    const editHeading = page.getByRole('heading', { name: /Edit Post/ })
    await expect(editHeading).toBeVisible({ timeout: 15000 })

    const editSwitcher = page.getByTestId('locale-switcher')
    await expect(editSwitcher).toBeVisible()
    await expect(editSwitcher).toContainText('English (en)')

    await editSwitcher.click()
    const idOption = page.getByTestId('locale-option-id')
    await expect(idOption).toBeVisible()
    await idOption.click()

    await expect(page).toHaveURL(/locale=id/)
    await expect(editSwitcher).toContainText('Indonesian (id)')

    // Verify fallback placeholder shows English title
    const titleInput = page.locator('input[name="title"]')
    await expect(titleInput).toHaveValue('')
    await expect(titleInput).toHaveAttribute('placeholder', enTitle)

    // Fill Indonesian translation
    await titleInput.fill(idTitle)
    await page.locator('textarea[name="excerpt"]').fill(idExcerpt)

    await richTextEditor.click()
    await richTextEditor.fill('Konten artikel bahasa Indonesia tentang arsitektur komputasi awan.')

    // Publish Indonesian translation
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByText('Published successfully!')).toBeVisible()

    // -------------------------------------------------------------
    // 4. Verify Both Translations on the Frontend (Unauthenticated Visitor)
    // -------------------------------------------------------------
    const publicContext = await browser.newContext()
    const publicPage = await publicContext.newPage()

    // 4a. Check English Homepage (/en) and Post Detail (/en/posts/...)
    await publicPage.goto('/en')
    await expect(publicPage.getByRole('link', { name: enTitle })).toBeVisible({ timeout: 15000 })
    await expect(publicPage.getByText(enExcerpt)).toBeVisible()

    // Click the article link to navigate to English detail page
    await publicPage.getByRole('link', { name: enTitle }).click()
    await expect(publicPage.getByRole('heading', { name: enTitle })).toBeVisible({ timeout: 15000 })
    await expect(
      publicPage.getByText('English article body detailing cloud architecture'),
    ).toBeVisible()

    // 4b. Check Indonesian Homepage (/id) and Post Detail (/id/posts/...)
    await publicPage.goto('/id')
    await expect(publicPage.getByRole('link', { name: idTitle })).toBeVisible({ timeout: 15000 })
    await expect(publicPage.getByText(idExcerpt)).toBeVisible()

    // Click the article link to navigate to Indonesian detail page
    await publicPage.getByRole('link', { name: idTitle }).click()
    await expect(publicPage.getByRole('heading', { name: idTitle })).toBeVisible({ timeout: 15000 })
    await expect(
      publicPage.getByText('Konten artikel bahasa Indonesia tentang arsitektur'),
    ).toBeVisible()

    // -------------------------------------------------------------
    // 5. Test Fallback for an Untranslated Post
    // -------------------------------------------------------------
    // In Admin, create Post 2 in English ONLY
    const untranslatedEnTitle = `Untranslated English Post ${id}`
    const untranslatedEnExcerpt = `This post only has English content ${id}`

    await page.goto('/admin/posts/create?locale=en')
    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()
    await page.locator('input[name="title"]').fill(untranslatedEnTitle)
    await page.locator('textarea[name="excerpt"]').fill(untranslatedEnExcerpt)
    await page.locator('.ProseMirror').click()
    await page.locator('.ProseMirror').fill('This post is exclusively written in English.')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible()

    // On Indonesian Homepage (/id), verify the untranslated post is visible with English fallback title
    await publicPage.goto('/id')
    await expect(publicPage.getByRole('link', { name: untranslatedEnTitle })).toBeVisible({
      timeout: 15000,
    })
    await expect(publicPage.getByText(untranslatedEnExcerpt)).toBeVisible()

    // Navigate to post on /id: fallback content in English is rendered
    await publicPage.getByRole('link', { name: untranslatedEnTitle }).click()
    await expect(publicPage.getByRole('heading', { name: untranslatedEnTitle })).toBeVisible({
      timeout: 15000,
    })
    await expect(publicPage.getByText('This post is exclusively written in English.')).toBeVisible()

    // -------------------------------------------------------------
    // 6. Preview a Draft in `id` While `en` Stays Live
    // -------------------------------------------------------------
    // Navigate back to the first post in admin under `id` locale
    await page.goto('/admin/posts')
    await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible()

    // Switch list locale to Indonesian
    const listSwitcher = page.getByTestId('locale-switcher')
    await listSwitcher.click()
    await page.getByTestId('locale-option-id').click()
    await expect(page).toHaveURL(/locale=id/)

    // Click the first post
    await page.getByRole('link', { name: idTitle }).click()
    await expect(page.getByRole('heading', { name: /Edit Post/ })).toBeVisible()

    // Edit Indonesian title to a draft value
    const draftIdTitle = `Draft Indonesian Update ${id}`
    await page.locator('input[name="title"]').fill(draftIdTitle)

    // Save as draft via Publishing options split button
    await page.getByRole('button', { name: 'Publishing options' }).click()
    const saveDraftBtn = page.getByRole('menuitem', { name: 'Save Draft' })
    await expect(saveDraftBtn).toBeVisible()
    await saveDraftBtn.click()

    // Wait for the update to complete
    await expect(page.locator('aside').getByText('Draft', { exact: true })).toBeVisible({
      timeout: 10000,
    })

    // 6a. Verify English public post is still completely LIVE with original published title
    await publicPage.goto('/en')
    await expect(publicPage.getByRole('link', { name: enTitle })).toBeVisible()
    await publicPage.getByRole('link', { name: enTitle }).click()
    await expect(publicPage.getByRole('heading', { name: enTitle })).toBeVisible()

    // 6b. Verify Indonesian public post still shows published title, NOT the draft title
    await publicPage.goto('/id')
    await expect(publicPage.getByRole('link', { name: idTitle })).toBeVisible()
    await expect(publicPage.getByRole('link', { name: draftIdTitle })).not.toBeVisible()

    // 6c. In Admin, open Live Preview: verify preview iframe loads draft preview in `id` with the draft title
    const livePreviewBtn = page.getByRole('button', { name: 'Live Preview' })
    await expect(livePreviewBtn).toBeVisible()
    await livePreviewBtn.click()

    const previewFrame = page.frameLocator('iframe[title="Live Preview"]')
    await expect(previewFrame.locator('[data-testid="preview-badge"]')).toBeVisible({
      timeout: 15000,
    })
    await expect(previewFrame.locator('[data-testid="post-title"]')).toHaveText(draftIdTitle)

    await publicContext.close()
  })
})
