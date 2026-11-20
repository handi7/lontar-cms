import { test, expect, type Page } from '@playwright/test'
import type { ClientConfig } from '@lontar/core/client'

test.describe('Admin Localization & Edit Forms (#428)', () => {
  const adminEmail = 'admin@example.com'
  const adminPassword = 'password123'

  test.beforeAll(async ({ request }) => {
    // Ensure admin user exists
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

  async function login(page: Page) {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
  }

  test('edits en and id of one document and reads both back', async ({ page }) => {
    const postStore: Record<string, Record<string, unknown>> = {
      en: {
        id: '1',
        title: 'Original English Title',
        slug: 'original-english-title',
        content: null,
        cover: null,
        author: null,
        categories: [],
        publishedAt: null,
        editorialNotes: '',
        _status: 'published',
        _isPublished: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      id: {
        id: '1',
        title: '',
        slug: 'original-english-title',
        content: null,
        cover: null,
        author: null,
        categories: [],
        publishedAt: null,
        editorialNotes: '',
        _status: 'published',
        _isPublished: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }

    // Intercept client config to provide localization settings
    await page.route('**/api/_lontar/config', async (route) => {
      const response = await route.fetch()
      const json = (await response.json()) as ClientConfig
      json.localization = {
        locales: [
          { code: 'en', label: 'English' },
          { code: 'id', label: 'Indonesian' },
        ],
        defaultLocale: 'en',
        fallback: true,
      }
      // Ensure title in posts is marked localized
      const postsCol = json.collections?.find((c) => c.slug === 'posts')
      if (postsCol) {
        for (const field of postsCol.fields) {
          if (field.name === 'title' || field.name === 'content') {
            field.localized = true
          }
        }
      }
      await route.fulfill({ json })
    })

    // Intercept posts document endpoints
    await page.route('**/api/posts/1?*', async (route) => {
      const url = new URL(route.request().url())
      const locale = url.searchParams.get('locale') || 'en'
      const method = route.request().method()

      if (method === 'GET') {
        const doc = postStore[locale] || postStore.en
        await route.fulfill({ json: doc })
        return
      }

      if (method === 'PATCH') {
        const body = (await route.request().postDataJSON()) as Record<string, unknown>
        const targetLocale = locale === 'id' ? 'id' : 'en'
        postStore[targetLocale] = {
          ...postStore[targetLocale],
          ...body,
          _status: 'published',
        }
        await route.fulfill({ json: postStore[targetLocale] })
        return
      }

      await route.continue()
    })

    await page.route('**/api/posts/1', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: postStore.en })
        return
      }
      if (route.request().method() === 'PATCH') {
        const body = (await route.request().postDataJSON()) as Record<string, unknown>
        postStore.en = { ...postStore.en, ...body, _status: 'published' }
        await route.fulfill({ json: postStore.en })
        return
      }
      await route.continue()
    })

    // Mock permissions and versions for smooth edit form operations
    await page.route('**/api/posts/1/permissions', async (route) => {
      await route.fulfill({
        json: {
          read: true,
          update: true,
          delete: true,
          fields: {},
        },
      })
    })

    await page.route('**/api/_lontar/versions/posts/1*', async (route) => {
      await route.fulfill({
        json: {
          docs: [],
          totalDocs: 0,
          page: 1,
          totalPages: 1,
        },
      })
    })

    await login(page)

    // Navigate to post 1 edit page
    await page.goto('/admin/posts/1')

    // 1. Verify Locale Switcher is rendered with English active
    const switcher = page.getByTestId('locale-switcher')
    await expect(switcher).toBeVisible({ timeout: 15000 })
    await expect(switcher).toContainText('English (en)')

    // Verify localized badge is rendered for title
    await expect(page.getByTestId('field-localized-title')).toBeVisible()

    // Title should contain the English value
    const titleInput = page.locator('input[name="title"]')
    await expect(titleInput).toHaveValue('Original English Title')

    // 2. Switch to Indonesian (id)
    await switcher.click()
    const idOption = page.getByTestId('locale-option-id')
    await expect(idOption).toBeVisible()
    await idOption.click()

    // URL should reflect ?locale=id
    await expect(page).toHaveURL(/locale=id/)
    await expect(switcher).toContainText('Indonesian (id)')

    // Fallback placeholder should show the English value since Indonesian title is empty
    await expect(titleInput).toHaveValue('')
    await expect(titleInput).toHaveAttribute('placeholder', 'Original English Title')

    // 3. Test unsaved changes guard when switching locales
    await titleInput.fill('Judul Bahasa Indonesia')

    // Attempt to switch back to English while dirty triggers confirmation dialog
    await switcher.click()
    const enOption = page.getByTestId('locale-option-en')
    const [dialog] = await Promise.all([
      page.waitForEvent('dialog'),
      enOption.click({ noWaitAfter: true }),
    ])
    expect(dialog.message()).toContain('You have unsaved changes')
    await dialog.dismiss() // Cancel switching

    // Should still be in id
    await expect(page).toHaveURL(/locale=id/)
    await expect(titleInput).toHaveValue('Judul Bahasa Indonesia')

    // 4. Save Indonesian title
    const publishButton = page.getByRole('button', { name: 'Publish', exact: true })
    await publishButton.click()
    await expect(page.getByText('Published successfully!')).toBeVisible()

    // Verify Indonesian was saved in the store
    expect(postStore.id.title).toBe('Judul Bahasa Indonesia')

    // 5. Switch to English (now not dirty)
    await switcher.click()
    await page.getByTestId('locale-option-en').click()
    await expect(page).toHaveURL(/locale=en/)
    await expect(switcher).toContainText('English (en)')

    // Verify English title is still intact and read back
    await expect(titleInput).toHaveValue('Original English Title')

    // Edit English title and save
    await titleInput.fill('Updated English Title')
    await publishButton.click()
    await expect(page.getByText('Published successfully!')).toBeVisible()
    expect(postStore.en.title).toBe('Updated English Title')

    // 6. Switch back to Indonesian and read both back
    await switcher.click()
    await page.getByTestId('locale-option-id').click()
    await expect(page).toHaveURL(/locale=id/)
    await expect(titleInput).toHaveValue('Judul Bahasa Indonesia')

    // Both English and Indonesian titles have been verified and persisted separately!
  })

  test('list view switcher and navigation locale persistence (#429)', async ({ page }) => {
    // Intercept client config to provide localization settings
    await page.route('**/api/_lontar/config', async (route) => {
      const response = await route.fetch()
      const json = (await response.json()) as ClientConfig
      json.localization = {
        locales: [
          { code: 'en', label: 'English' },
          { code: 'id', label: 'Indonesian' },
        ],
        defaultLocale: 'en',
        fallback: true,
      }
      await route.fulfill({ json })
    })

    await page.route('**/api/posts?*', async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        json: {
          docs: [
            {
              id: '1',
              title: url.searchParams.get('locale') === 'id' ? 'Judul Pos ID' : 'Post Title EN',
              slug: 'post-1',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          totalDocs: 1,
          limit: 10,
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      })
    })

    await login(page)

    // Go to posts list
    await page.goto('/admin/posts')

    // 1. Locale switcher is visible in list view header
    const listSwitcher = page.getByTestId('locale-switcher')
    await expect(listSwitcher).toBeVisible({ timeout: 15000 })
    await expect(listSwitcher).toContainText('English (en)')

    // 2. Switch to Indonesian
    await listSwitcher.click()
    const idOption = page.getByTestId('locale-option-id')
    await expect(idOption).toBeVisible()
    await idOption.click()

    await expect(page).toHaveURL(/locale=id/)
    await expect(listSwitcher).toContainText('Indonesian (id)')

    // Verify list displays Indonesian document
    await expect(page.getByText('Judul Pos ID')).toBeVisible()

    // 3. Create button preserves active locale
    const createBtn = page.getByRole('link', { name: 'Create Post' })
    await expect(createBtn).toHaveAttribute('href', expect.stringContaining('locale=id'))

    // 4. Row title link preserves active locale
    const rowTitleLink = page.getByRole('link', { name: 'Judul Pos ID' })
    await expect(rowTitleLink).toHaveAttribute('href', expect.stringContaining('locale=id'))

    // Mock single post fetch for edit view navigation
    await page.route('**/api/posts/1?*', async (route) => {
      await route.fulfill({
        json: {
          id: '1',
          title: 'Judul Pos ID',
          slug: 'post-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          _status: 'draft',
        },
      })
    })
    await page.route('**/api/posts/1/permissions', async (route) => {
      await route.fulfill({
        json: { read: true, update: true, delete: true, fields: {} },
      })
    })
    await page.route('**/api/_lontar/versions/posts/1*', async (route) => {
      await route.fulfill({
        json: { docs: [], totalDocs: 0, page: 1, totalPages: 1 },
      })
    })

    // 5. Navigate to post edit view and check breadcrumbs back to list
    await rowTitleLink.click()
    await expect(page).toHaveURL(/\/admin\/posts\/1\?.*locale=id/)

    // Breadcrumb link back to collection preserves locale
    const breadcrumbLink = page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Posts' })
    await expect(breadcrumbLink).toHaveAttribute('href', expect.stringContaining('locale=id'))
  })

  test('live preview resolves {locale} token and updates on locale change (#429)', async ({
    page,
  }) => {
    // Intercept client config to provide localization settings and preview url with {locale}
    await page.route('**/api/_lontar/config', async (route) => {
      const response = await route.fetch()
      const json = (await response.json()) as ClientConfig
      json.localization = {
        locales: [
          { code: 'en', label: 'English' },
          { code: 'id', label: 'Indonesian' },
        ],
        defaultLocale: 'en',
        fallback: true,
      }
      const postsCol = json.collections?.find((c) => c.slug === 'posts')
      if (postsCol) {
        postsCol.admin.preview = {
          url: '/{locale}/posts/{slug}?preview=1',
        }
        for (const field of postsCol.fields) {
          if (field.name === 'title') {
            field.localized = true
          }
        }
      }
      await route.fulfill({ json })
    })

    // Mock document
    await page.route('**/api/posts/1?*', async (route) => {
      const url = new URL(route.request().url())
      const locale = url.searchParams.get('locale') || 'en'
      await route.fulfill({
        json: {
          id: '1',
          title: locale === 'id' ? 'Judul Indo' : 'English Title',
          slug: 'test-slug',
          _status: 'draft',
        },
      })
    })

    await page.route('**/api/posts/1', async (route) => {
      await route.fulfill({
        json: {
          id: '1',
          title: 'English Title',
          slug: 'test-slug',
          _status: 'draft',
        },
      })
    })

    await page.route('**/api/posts/1/permissions', async (route) => {
      await route.fulfill({
        json: {
          read: true,
          update: true,
          delete: true,
          fields: {},
        },
      })
    })

    await page.route('**/api/_lontar/versions/posts/1*', async (route) => {
      await route.fulfill({
        json: { docs: [], totalDocs: 0, page: 1, totalPages: 1 },
      })
    })

    await login(page)

    // Open post in Indonesian
    await page.goto('/admin/posts/1?locale=id')

    // Open Live Preview
    const livePreviewBtn = page.getByRole('button', { name: 'Live Preview' })
    await expect(livePreviewBtn).toBeVisible({ timeout: 15000 })
    await livePreviewBtn.click()

    // Verify preview iframe was created and its src has {locale} resolved to id!
    const iframe = page.locator('iframe[title="Live Preview"]')
    await expect(iframe).toBeVisible()
    await expect(iframe).toHaveAttribute('src', '/id/posts/test-slug?preview=1')

    // Switch locale to English
    const switcher = page.getByTestId('locale-switcher')
    await switcher.click()
    await page.getByTestId('locale-option-en').click()
    await expect(page).toHaveURL(/locale=en/)

    // Verify preview iframe src was updated to English (/en/posts/test-slug?preview=1)
    await expect(iframe).toHaveAttribute('src', '/en/posts/test-slug?preview=1')
  })
})
