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
})
