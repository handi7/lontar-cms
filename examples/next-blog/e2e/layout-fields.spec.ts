import { test, expect, type Page } from '@playwright/test'

test.describe('Layout fields: tabs, row, and collapsible (#510)', () => {
  const adminEmail = 'admin@example.com'
  const adminPassword = 'password123'

  test.beforeAll(async ({ request }) => {
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

  async function loginAsAdmin(page: Page) {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('link', { name: 'Categories', exact: true })).toBeVisible({
      timeout: 15000,
    })
  }

  test('shows error badge on hidden tab, auto-switches to it on failed submit, and opens collapsed section on error', async ({
    page,
  }) => {
    await loginAsAdmin(page)

    await page.getByRole('link', { name: 'Categories', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Category' }).first().click()
    await expect(page.getByRole('heading', { name: 'Create Category' })).toBeVisible()

    const generalTab = page.getByRole('tab', { name: /General/ })
    const urlTab = page.getByRole('tab', { name: /URL/ })

    await expect(generalTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('input[name="name"]')).toBeVisible()

    // Switch to the URL tab so the required `name` field on General is hidden
    await urlTab.click()
    await expect(urlTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('input[name="name"]')).not.toBeVisible()

    // Submit with empty `name` while on the URL tab
    await page.getByRole('button', { name: 'Create Category' }).click()

    // Error badge appears on General tab and the active tab switches back to General
    await expect(generalTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('tab-error-badge-categoryTabs-tab-0')).toHaveText('1')
    await expect(page.locator('input[name="name"]')).toBeVisible()

    // Switch back to URL tab and test Collapsible (initiallyCollapsed: true)
    await urlTab.click()
    const slugToggle = page.getByRole('button', { name: /Slug Settings/i })
    await expect(slugToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('input[name="slug"]')).not.toBeVisible()

    // Expand, enter invalid slug, collapse again, fill valid name, and submit
    await slugToggle.click()
    await expect(slugToggle).toHaveAttribute('aria-expanded', 'true')
    await page.locator('input[name="slug"]').fill('Invalid Slug!')
    await slugToggle.click()
    await expect(slugToggle).toHaveAttribute('aria-expanded', 'false')

    await generalTab.click()
    await page.locator('input[name="name"]').fill(`Layout Cat ${Date.now()}`)
    await page.getByRole('button', { name: 'Create Category' }).click()

    // Failed submit switches to URL tab and auto-opens the collapsed Slug Settings section
    await expect(urlTab).toHaveAttribute('aria-selected', 'true')
    await expect(slugToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('input[name="slug"]')).toBeVisible()
  })

  test('renders row fields side-by-side on desktop and stacks them on narrow screens', async ({
    page,
  }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/pages/create')
    await expect(page.getByRole('heading', { name: 'Create Page' })).toBeVisible()

    const titleInput = page.locator('input[name="title"]')
    const slugInput = page.locator('input[name="slug"]')
    await expect(titleInput).toBeVisible()
    await expect(slugInput).toBeVisible()

    // Desktop width: side-by-side
    await page.setViewportSize({ width: 1280, height: 800 })
    const desktopTitleBox = await titleInput.boundingBox()
    const desktopSlugBox = await slugInput.boundingBox()
    expect(desktopTitleBox).not.toBeNull()
    expect(desktopSlugBox).not.toBeNull()
    expect(desktopSlugBox!.x).toBeGreaterThan(desktopTitleBox!.x)
    expect(Math.abs(desktopSlugBox!.y - desktopTitleBox!.y)).toBeLessThan(20)

    // Narrow mobile width: stacked vertically
    await page.setViewportSize({ width: 375, height: 800 })
    const mobileTitleBox = await titleInput.boundingBox()
    const mobileSlugBox = await slugInput.boundingBox()
    expect(mobileTitleBox).not.toBeNull()
    expect(mobileSlugBox).not.toBeNull()
    expect(mobileSlugBox!.y).toBeGreaterThan(mobileTitleBox!.y)
  })
})
