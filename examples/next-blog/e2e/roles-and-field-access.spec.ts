import { test, expect, type Page } from '@playwright/test'

test.describe('Roles and Field-Level Access Control (M10)', () => {
  const adminEmail = 'admin@example.com'
  const editorEmail = 'editor@example.com'
  const authorEmail = 'author@example.com'
  const userPassword = 'password123'

  test.beforeAll(async ({ request }) => {
    // 1. Ensure admin user exists via first-user onboarding endpoint
    const checkRes = await request.get('/api/_lontar/first-user')
    if (checkRes.ok()) {
      const { canRegisterFirstUser } = (await checkRes.json()) as { canRegisterFirstUser: boolean }
      if (canRegisterFirstUser) {
        await request.post('/api/_lontar/first-user', {
          data: {
            name: 'Admin User',
            email: adminEmail,
            password: userPassword,
          },
        })
      }
    }

    // 2. Sign in as admin to manage users
    const signInRes = await request.post('/api/auth/sign-in/email', {
      data: {
        email: adminEmail,
        password: userPassword,
      },
    })
    expect(signInRes.ok()).toBe(true)

    // 3. Ensure editor user exists
    await request.post('/api/_lontar/users', {
      data: {
        name: 'Editor User',
        email: editorEmail,
        password: userPassword,
        role: 'editor',
      },
    })

    // 4. Ensure author user exists
    await request.post('/api/_lontar/users', {
      data: {
        name: 'Author User',
        email: authorEmail,
        password: userPassword,
        role: 'author',
      },
    })
  })

  async function loginAs(page: Page, email: string) {
    await page.context().clearCookies()
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill(userPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
  }

  test('Author: has restricted sidebar navigation, hides editorialNotes, and locks publishedAt', async ({
    page,
    request,
  }) => {
    await loginAs(page, authorEmail)

    // 1. Sidebar visibility checks for Author
    await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pages', exact: true })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Site Settings', exact: true })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Users', exact: true })).not.toBeVisible()

    // 2. Open Posts collection
    await page.getByRole('link', { name: 'Posts', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()

    // 3. Create a post as Author
    await page.getByRole('link', { name: 'Create Post' }).first().click()
    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()

    // Verify editorialNotes field is not in the DOM
    await expect(page.locator('textarea[name="editorialNotes"]')).toHaveCount(0)

    // Verify publishedAt is locked/disabled for author on create view as well (#384)
    const createPublishedAtButton = page.getByRole('button', { name: 'Published At' })
    await expect(createPublishedAtButton).toBeVisible()
    await expect(createPublishedAtButton).toBeDisabled()

    const postTitle = `Author Article ${Date.now()}`
    await page.locator('input[name="title"]').fill(postTitle)

    // Publish post
    await page.getByRole('button', { name: 'Publish', exact: true }).click()

    // 4. Verify post appears in list and navigate to edit view
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await page.getByRole('link', { name: postTitle }).click()
    await expect(page.getByRole('heading', { name: /Edit Post/ })).toBeVisible()

    // In edit view: editorialNotes is still hidden
    await expect(page.locator('textarea[name="editorialNotes"]')).toHaveCount(0)

    // publishedAt is visible but disabled for author (lock indicator)
    const publishedAtButton = page.getByRole('button', { name: 'Published At' })
    await expect(publishedAtButton).toBeVisible()
    await expect(publishedAtButton).toBeDisabled()

    // Verify Author cannot delete the post
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)

    // 5. Query REST API with Author session cookies: editorialNotes must be stripped
    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const apiRes = await request.get('/api/posts', {
      headers: {
        Cookie: cookieHeader,
      },
    })
    expect(apiRes.ok()).toBe(true)
    const data = (await apiRes.json()) as {
      docs: Array<{ title: string; editorialNotes?: unknown }>
    }
    const targetPost = data.docs.find((p) => p.title === postTitle)
    expect(targetPost).toBeDefined()
    expect(targetPost?.editorialNotes).toBeUndefined()
  })

  test('Editor: can edit editorialNotes, publishedAt, and Pages, but reviewNotes and Site Settings are locked/hidden', async ({
    page,
    request,
  }) => {
    await loginAs(page, editorEmail)

    // 1. Sidebar visibility checks for Editor
    await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pages', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Site Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Users', exact: true })).not.toBeVisible()

    // 2. Editor edits a post: editorialNotes and publishedAt are enabled
    await page.getByRole('link', { name: 'Posts', exact: true }).click()
    await page.getByRole('link', { name: 'Create Post' }).first().click()
    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()

    // editorialNotes is visible and editable for Editor
    const notesInput = page.locator('textarea[name="editorialNotes"]')
    await expect(notesInput).toBeVisible()
    await expect(notesInput).toBeEnabled()
    await notesInput.fill('Editor internal review note: approved for publishing.')

    const postTitle = `Editor Article ${Date.now()}`
    await page.locator('input[name="title"]').fill(postTitle)

    // publishedAt is enabled
    const publishedAtButton = page.getByRole('button', { name: 'Published At' })
    await expect(publishedAtButton).toBeVisible()
    await expect(publishedAtButton).toBeEnabled()

    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()

    // Query published post slug and verify public page HTML does not leak editorialNotes (#367)
    const publicPostRes = await request.get('/api/posts')
    expect(publicPostRes.ok()).toBe(true)
    const publicPostsData = (await publicPostRes.json()) as {
      docs: Array<{ title: string; slug: string }>
    }
    const createdPost = publicPostsData.docs.find((p) => p.title === postTitle)
    expect(createdPost).toBeDefined()

    const webPostRes = await request.get(`/posts/${createdPost?.slug}`)
    expect(webPostRes.ok()).toBe(true)
    const webPostHtml = await webPostRes.text()
    expect(webPostHtml).not.toContain('Editor internal review note: approved for publishing.')

    // 3. Pages collection: Editor can create a page, but reviewNotes in SEO group is hidden
    await page.getByRole('link', { name: 'Pages', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Create Page' }).first().click()
    await expect(page.getByRole('heading', { name: 'Create Page' })).toBeVisible()

    const pageTitle = `Editor Page ${Date.now()}`
    await page.locator('input[name="title"]').fill(pageTitle)

    // SEO group fields: metaTitle is visible, reviewNotes is hidden
    await expect(page.locator('input[name="seo.metaTitle"]')).toBeVisible()
    await page.locator('input[name="seo.metaTitle"]').fill('Editor Meta Title')
    await expect(page.locator('textarea[name="seo.reviewNotes"]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()

    // 4. Site Settings global: Editor can view Site Settings, but inputs are disabled (read-only)
    await page.getByRole('link', { name: 'Site Settings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Site Settings', exact: true })).toBeVisible()

    const siteNameInput = page.locator('input[name="siteName"]')
    await expect(siteNameInput).toBeVisible()
    await expect(siteNameInput).toBeDisabled()

    // Save button is not rendered in read-only mode
    await expect(page.getByRole('button', { name: /save/i })).not.toBeVisible()
  })

  test('Admin: full access to SEO reviewNotes, Site Settings, user management, and API keys', async ({
    page,
    request,
  }) => {
    await loginAs(page, adminEmail)

    // 1. Sidebar checks: Users is visible for Admin
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible()

    // 2. Admin edits Pages: reviewNotes inside SEO group is visible and editable
    await page.getByRole('link', { name: 'Pages', exact: true }).click()
    await page.getByRole('link', { name: 'Create Page' }).first().click()
    await expect(page.getByRole('heading', { name: 'Create Page' })).toBeVisible()

    const pageTitle = `Admin Page ${Date.now()}`
    await page.locator('input[name="title"]').fill(pageTitle)

    const reviewNotes = page.locator('textarea[name="seo.reviewNotes"]')
    await expect(reviewNotes).toBeVisible()
    await expect(reviewNotes).toBeEnabled()
    await reviewNotes.fill('Admin internal audit passed: ready for deployment.')

    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()

    // Query published page slug and verify public page HTML does not leak reviewNotes (#367)
    const adminCookies = await page.context().cookies()
    const adminCookieHeader = adminCookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const adminPagesRes = await request.get('/api/pages', {
      headers: { Cookie: adminCookieHeader },
    })
    expect(adminPagesRes.ok()).toBe(true)
    const adminPagesData = (await adminPagesRes.json()) as {
      docs: Array<{ title: string; slug: string }>
    }
    const createdAdminPage = adminPagesData.docs.find((p) => p.title === pageTitle)
    expect(createdAdminPage).toBeDefined()

    const webPageRes = await request.get(`/${createdAdminPage?.slug}`)
    expect(webPageRes.ok()).toBe(true)
    const webPageHtml = await webPageRes.text()
    expect(webPageHtml).not.toContain('Admin internal audit passed: ready for deployment.')

    // 3. Admin can edit and save Site Settings
    await page.getByRole('link', { name: 'Site Settings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Site Settings', exact: true })).toBeVisible()

    const siteNameInput = page.locator('input[name="siteName"]')
    await expect(siteNameInput).toBeVisible()
    await expect(siteNameInput).toBeEnabled()
    await siteNameInput.fill(`Lontar Blog Updated ${Date.now()}`)

    const saveButton = page.getByRole('button', { name: 'Save Changes' })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(page.getByText('Changes saved successfully.')).toBeVisible()

    // 4. User management: Admin can view and search user list
    await page.getByRole('link', { name: 'Users', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()

    const searchInput = page.getByPlaceholder('Search by name or email...')
    await searchInput.fill(adminEmail)
    await expect(page.getByRole('table').getByText(adminEmail)).toBeVisible()

    await searchInput.fill(editorEmail)
    await expect(page.getByRole('table').getByText(editorEmail)).toBeVisible()

    await searchInput.fill(authorEmail)
    await expect(page.getByRole('table').getByText(authorEmail)).toBeVisible()

    // 5. API Key usage: generate an API key via admin session and query REST API
    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const apiKeyRes = await request.post('/api/_lontar/api-keys', {
      headers: {
        Cookie: cookieHeader,
      },
      data: {
        name: 'M10 E2E Key',
      },
    })
    expect(apiKeyRes.ok()).toBe(true)
    const { apiKey } = (await apiKeyRes.json()) as { apiKey: { key: string } }
    expect(apiKey.key).toMatch(/^lt_[a-f0-9]{64}$/)

    // Unauthenticated request to /api/pages returns 403 (editor/admin only)
    const unauthedPagesRes = await request.get('/api/pages')
    expect(unauthedPagesRes.status()).toBe(403)

    // Query REST API with API key in header (/api/pages proves key carries admin role)
    const pageQueryRes = await request.get('/api/pages', {
      headers: {
        'x-api-key': apiKey.key,
      },
    })
    expect(pageQueryRes.ok()).toBe(true)
    const pagesData = (await pageQueryRes.json()) as { docs: unknown[] }
    expect(Array.isArray(pagesData.docs)).toBe(true)
  })
})
