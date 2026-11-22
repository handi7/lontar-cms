import { test, expect, type Page } from '@playwright/test'

// #213: the nav sidebar collapses to a rail on desktop and becomes a drawer on small screens.
test.describe('Collapsible sidebar (#213)', () => {
  const adminEmail = 'admin@example.com'
  const adminPassword = 'password123'

  test.beforeAll(async ({ request }) => {
    const checkRes = await request.get('/api/_lontar/first-user')
    if (checkRes.ok()) {
      const { canRegisterFirstUser } = (await checkRes.json()) as { canRegisterFirstUser: boolean }
      if (canRegisterFirstUser) {
        await request.post('/api/_lontar/first-user', {
          data: { name: 'Admin User', email: adminEmail, password: adminPassword },
        })
      }
    }
  })

  async function signIn(page: Page) {
    await page.goto('/admin/login')
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()
  }

  test('collapses to a rail, keeps navigating, and stays collapsed after a reload', async ({
    page,
  }) => {
    await signIn(page)
    const sidebar = page.locator('aside')
    await expect(sidebar.getByRole('link', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 15000,
    })
    const expandedWidth = (await sidebar.boundingBox())?.width ?? 0

    await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    await expect(sidebar.getByText('Collections')).toBeHidden()
    const railWidth = (await sidebar.boundingBox())?.width ?? 0
    expect(railWidth).toBeLessThan(expandedWidth / 2)

    // A collapsed item is still a link named after its label, and a tooltip spells it out.
    const posts = sidebar.getByRole('link', { name: 'Posts', exact: true })
    await posts.hover()
    await expect(page.getByRole('tooltip')).toContainText('Posts')
    await posts.click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()

    await page.reload()
    await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()

    await sidebar.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(sidebar.getByText('Collections')).toBeVisible()
    await page.reload()
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('hides the sidebar behind a menu button and navigates through the drawer', async ({
      page,
    }) => {
      await signIn(page)
      const menu = page.getByRole('button', { name: 'Open navigation' })
      await expect(menu).toBeVisible({ timeout: 15000 })
      await expect(page.locator('aside')).toBeHidden()

      await menu.click()
      const drawer = page.getByRole('dialog', { name: 'Navigation' })
      await expect(drawer).toBeVisible()
      await drawer.getByRole('link', { name: 'Posts', exact: true }).click()

      await expect(page).toHaveURL(/\/admin\/posts/)
      await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
      await expect(drawer).toBeHidden()

      // The menu button works again after the drawer closed.
      await menu.click()
      await expect(drawer).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      // The page must not scroll sideways. When it does, name what sticks out, so the failure
      // says where and not only that something did.
      const offenders = await page.evaluate(() => {
        const root = document.documentElement
        if (root.scrollWidth <= root.clientWidth) return []
        return Array.from(document.querySelectorAll('.lontar-admin *'))
          .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`)
      })
      expect(offenders).toEqual([])
    })
  })
})
