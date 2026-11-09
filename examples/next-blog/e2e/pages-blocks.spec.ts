import { test, expect } from '@playwright/test'
import { chooseOption } from './helpers'

test.describe('Pages Collection & Blocks Feature (M7)', () => {
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

  test('creates a page with blocks, reorders blocks, toggles conditional fields, and renders on frontend', async ({
    page,
  }) => {
    const id = Date.now()
    const pageTitle = `Platform Architecture ${id}`
    const pageSlug = `platform-architecture-${id}`

    // -------------------------------------------------------------
    // 1. Log in to the Admin Panel
    // -------------------------------------------------------------
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Sign in to Admin' })).toBeVisible({
      timeout: 15000,
    })
    await page.locator('input[type="email"]').fill(adminEmail)
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.getByRole('button', { name: 'Sign In' }).click()

    // -------------------------------------------------------------
    // 2. Navigate to Pages Collection
    // -------------------------------------------------------------
    const pagesLink = page.getByRole('link', { name: 'Pages', exact: true })
    await expect(pagesLink).toBeVisible({ timeout: 15000 })
    await pagesLink.click()

    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()

    // -------------------------------------------------------------
    // 3. Open Create Page Form
    // -------------------------------------------------------------
    const createBtn = page.getByRole('link', { name: 'Create Page' }).first()
    await expect(createBtn).toBeVisible()
    await createBtn.click()

    await expect(page.getByRole('heading', { name: 'Create Page' })).toBeVisible()

    // Fill Title and Slug
    await page.locator('input[name="title"]').fill(pageTitle)
    await page.locator('input[name="slug"]').fill(pageSlug)

    // Fill SEO Group Fields
    await page.locator('input[name="seo.metaTitle"]').fill(`SEO: ${pageTitle}`)
    await page
      .locator('textarea[name="seo.metaDescription"]')
      .fill('Detailed architectural overview and blocks breakdown.')

    // -------------------------------------------------------------
    // 4. Add First Block: Call to Action (with conditional fields)
    // -------------------------------------------------------------
    await page.getByRole('button', { name: 'Add block' }).click()
    await page.getByRole('button', { name: 'Call to Action' }).click()

    const block0 = page.locator('[data-block-row="0"]')
    await expect(block0).toBeVisible()

    // Fill CTA headline and buttonLabel
    await page.locator('input[name="layout.0.headline"]').fill('Explore Documentation')
    await page.locator('input[name="layout.0.buttonLabel"]').fill('Get Started')

    // Verify conditional fields in Call to Action:
    // Default linkType is 'internal' -> internalPage is visible, externalUrl is hidden
    await expect(block0.locator('[data-testid="relationship-open-search"]')).toBeVisible()
    await expect(page.locator('input[name="layout.0.externalUrl"]')).not.toBeVisible()

    // Switch linkType to 'External'
    await chooseOption(page, /link type/i, 'External')

    // externalUrl mounts, internalPage unmounts
    await expect(page.locator('input[name="layout.0.externalUrl"]')).toBeVisible()
    await expect(block0.locator('[data-testid="relationship-open-search"]')).not.toBeVisible()

    // Fill externalUrl
    await page
      .locator('input[name="layout.0.externalUrl"]')
      .fill('https://github.com/handi7/lontar-cms')

    // -------------------------------------------------------------
    // 5. Add Second Block: Hero
    // -------------------------------------------------------------
    await page.getByRole('button', { name: 'Add block' }).click()
    await page.getByRole('button', { name: 'Hero' }).click()

    const block1 = page.locator('[data-block-row="1"]')
    await expect(block1).toBeVisible()

    await page.locator('input[name="layout.1.heading"]').fill('Headless Reimagined')
    await page
      .locator('textarea[name="layout.1.subheading"]')
      .fill('Flexible content blocks with pure React SPA admin.')

    // -------------------------------------------------------------
    // 6. Reorder Blocks (Move Hero up before Call to Action)
    // -------------------------------------------------------------
    // Click "Move block up" on row 1 (Hero)
    await page
      .locator('[data-block-row="1"]')
      .getByRole('button', { name: 'Move block up' })
      .click()

    // Now row 0 is Hero and row 1 is Call to Action
    await expect(page.locator('input[name="layout.0.heading"]')).toHaveValue('Headless Reimagined')
    await expect(page.locator('input[name="layout.1.headline"]')).toHaveValue(
      'Explore Documentation',
    )

    // -------------------------------------------------------------
    // 7. Add Third Block: Rich Text
    // -------------------------------------------------------------
    await page.getByRole('button', { name: 'Add block' }).click()
    await page.getByRole('button', { name: 'Rich Text' }).click()

    const block2 = page.locator('[data-block-row="2"]')
    await expect(block2).toBeVisible()

    const editor = block2.locator('.ProseMirror')
    await editor.click()
    await editor.fill('Lontar is built from the ground up for modern developer workflows.')

    // -------------------------------------------------------------
    // 8. Submit Page Form
    // -------------------------------------------------------------
    await page.getByRole('button', { name: 'Create Page' }).click()

    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: pageTitle })).toBeVisible()

    // -------------------------------------------------------------
    // 9. Verify Frontend Rendered Page
    // -------------------------------------------------------------
    await page.goto(`/${pageSlug}`)

    // Check page header and SEO metadata
    await expect(page.locator('[data-testid="page-title"]')).toHaveText(pageTitle)
    await expect(page).toHaveTitle(`SEO: ${pageTitle}`)

    // Check block sequence and contents
    const renderedBlocks = page.locator('[data-testid="page-blocks"] > section')
    await expect(renderedBlocks).toHaveCount(3)

    // Block 1: Hero (reordered to top)
    const heroSection = renderedBlocks.nth(0)
    await expect(heroSection).toHaveAttribute('data-block-type', 'hero')
    await expect(heroSection.locator('[data-testid="hero-heading"]')).toHaveText(
      'Headless Reimagined',
    )
    await expect(heroSection.locator('[data-testid="hero-subheading"]')).toContainText(
      'Flexible content blocks',
    )

    // Block 2: Call to Action (moved down)
    const ctaSection = renderedBlocks.nth(1)
    await expect(ctaSection).toHaveAttribute('data-block-type', 'callToAction')
    await expect(ctaSection.locator('[data-testid="cta-headline"]')).toHaveText(
      'Explore Documentation',
    )
    const ctaBtn = ctaSection.locator('[data-testid="cta-button"]')
    await expect(ctaBtn).toHaveText('Get Started')
    await expect(ctaBtn).toHaveAttribute('href', 'https://github.com/handi7/lontar-cms')
    await expect(ctaBtn).toHaveAttribute('target', '_blank')

    // Block 3: Rich Text
    const richTextSection = renderedBlocks.nth(2)
    await expect(richTextSection).toHaveAttribute('data-block-type', 'richText')
    await expect(richTextSection).toContainText(
      'Lontar is built from the ground up for modern developer workflows.',
    )
  })
})
