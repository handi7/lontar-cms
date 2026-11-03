import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test.describe('Next.js Blog Authoring and Viewing Experience', () => {
  const adminEmail = 'admin@example.com'
  const adminPassword = 'password123'
  const testImagePath = path.resolve(__dirname, 'fixtures/test-image.png')

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

  test('full end-to-end flow: author content in admin and view on public blog', async ({
    page,
  }) => {
    const id = Date.now()
    const authorName = `Alex Rivera ${id}`
    const categoryName = `Architecture ${id}`
    const postTitle = `Building Modern Headless Systems ${id}`
    const mediaAlt = `System Architecture Blueprint ${id}`

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

    await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 15000,
    })

    // -------------------------------------------------------------
    // 2. Configure Global Site Settings
    // -------------------------------------------------------------
    const siteSettingsLink = page.getByRole('link', { name: 'Site Settings', exact: true })
    await expect(siteSettingsLink).toBeVisible()
    await siteSettingsLink.click()

    await expect(page.getByRole('heading', { name: 'Site Settings' })).toBeVisible()
    await page.locator('input[name="siteName"]').fill('Lontar Engineering Blog')
    await page
      .locator('textarea[name="footerText"]')
      .fill('Built with Lontar CMS • An open-source headless CMS.')
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Changes saved successfully.')).toBeVisible()

    // -------------------------------------------------------------
    // 3. Create an Author
    // -------------------------------------------------------------
    await page.getByRole('link', { name: 'Authors', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Authors', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Author' }).first().click()

    await expect(page.getByRole('heading', { name: 'Create Author' })).toBeVisible()
    await page.locator('input[name="name"]').fill(authorName)
    await page
      .locator('textarea[name="bio"]')
      .fill('Staff Engineer writing on system architecture and modern web design.')
    await page.getByRole('button', { name: 'Create Author' }).click()
    await expect(page.getByRole('heading', { name: 'Authors', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: authorName })).toBeVisible()

    // -------------------------------------------------------------
    // 4. Create a Category
    // -------------------------------------------------------------
    await page.getByRole('link', { name: 'Categories', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Category' }).first().click()

    await expect(page.getByRole('heading', { name: 'Create Category' })).toBeVisible()
    await page.locator('input[name="name"]').fill(categoryName)
    await page.getByRole('button', { name: 'Create Category' }).click()
    await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: categoryName })).toBeVisible()

    // -------------------------------------------------------------
    // 5. Upload Media
    // -------------------------------------------------------------
    await page.getByRole('link', { name: 'Media', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Media', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Media' }).first().click()

    await expect(page.getByRole('heading', { name: 'Create Media' })).toBeVisible()
    await page.locator('input[type="file"]').setInputFiles(testImagePath)
    await page.locator('input[name="alt"]').fill(mediaAlt)
    await page.getByRole('button', { name: 'Create Media' }).click()
    await expect(page.getByRole('heading', { name: 'Media', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: mediaAlt })).toBeVisible()

    // -------------------------------------------------------------
    // 6. Create a Published Blog Post
    // -------------------------------------------------------------
    await page.getByRole('link', { name: 'Posts', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Create Post' }).first().click()

    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible()
    await page.locator('input[name="title"]').fill(postTitle)
    await page.locator('select[name="status"]').selectOption('published')

    // Select Author (single relationship)
    const authorSearchInput = page.locator('input[data-testid="relationship-search"]').first()
    await authorSearchInput.fill(authorName)
    const authorOption = page.getByRole('button', { name: new RegExp(authorName, 'i') }).first()
    await expect(authorOption).toBeVisible()
    await authorOption.click()
    await expect(page.locator('[data-testid="relationship-single-selected"]')).toContainText(
      authorName,
    )

    // Select Category (many relationship)
    const addCategoryBtn = page.locator('[data-testid="relationship-add-btn"]').first()
    await addCategoryBtn.click()
    const categoryOption = page.getByRole('button', { name: new RegExp(categoryName, 'i') }).first()
    await expect(categoryOption).toBeVisible()
    await categoryOption.click()
    await expect(page.locator('[data-testid="relationship-many-list"]')).toContainText(categoryName)

    // Select Cover (upload picker)
    const browseMediaBtn = page.locator('[data-testid="upload-picker-browse-btn"]').first()
    await browseMediaBtn.click()
    const mediaOption = page.locator('[data-testid^="upload-option-"]').first()
    await expect(mediaOption).toBeVisible()
    await mediaOption.click()
    await expect(page.locator('[data-testid="upload-picker-selected"]')).toBeVisible()

    // Fill Rich Text Content
    const richTextEditor = page.locator('.ProseMirror')
    await richTextEditor.click()
    await richTextEditor.fill(
      'This article explores how to architect a modern headless CMS with TypeScript.',
    )

    // Submit post
    await page.getByRole('button', { name: 'Create Post' }).click()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: postTitle })).toBeVisible()

    // -------------------------------------------------------------
    // 7. Verify Public Frontend - Homepage (/)
    // -------------------------------------------------------------
    await page.goto('/')

    // Site settings in header and footer
    await expect(page.locator('[data-testid="site-title"]')).toContainText(
      'Lontar Engineering Blog',
    )
    await expect(page.locator('[data-testid="footer-text"]')).toContainText('Built with Lontar CMS')

    // Category filter button
    await expect(page.getByRole('link', { name: categoryName, exact: true }).first()).toBeVisible()

    // Post card rendering
    const postCard = page.locator('article', { hasText: postTitle })
    await expect(postCard).toBeVisible()
    await expect(postCard.getByText(`By ${authorName}`)).toBeVisible()
    await expect(postCard.getByRole('link', { name: categoryName })).toBeVisible()

    // Verify cover image
    const postCoverImg = postCard.locator('img')
    await expect(postCoverImg).toBeVisible()
    const imgSrc = await postCoverImg.getAttribute('src')
    expect(imgSrc).toContain('/api/media/file/')

    // -------------------------------------------------------------
    // 8. Verify Public Frontend - Post Detail (/posts/[slug])
    // -------------------------------------------------------------
    await page.getByRole('link', { name: postTitle }).click()
    await expect(page).toHaveURL(/\/posts\//)

    // Post title heading
    await expect(page.locator('[data-testid="post-title"]')).toHaveText(postTitle)

    // Author metadata & bio
    await expect(page.locator('[data-testid="post-author"]')).toHaveText(`By ${authorName}`)
    await expect(page.locator('[data-testid="author-bio"]')).toContainText(authorName)
    await expect(page.locator('[data-testid="author-bio"]')).toContainText(
      'Staff Engineer writing on system architecture',
    )

    // Cover image on detail page
    await expect(page.locator('[data-testid="post-cover"] img')).toBeVisible()

    // Rendered rich text content
    await expect(page.locator('[data-testid="post-content"]')).toContainText(
      'This article explores how to architect a modern headless CMS with TypeScript.',
    )

    // -------------------------------------------------------------
    // 9. Verify Public Frontend - Category Page
    // -------------------------------------------------------------
    await page.getByRole('link', { name: categoryName }).first().click()
    await expect(page.locator('[data-testid="category-title"]')).toHaveText(categoryName)
    await expect(page.getByRole('link', { name: postTitle })).toBeVisible()
  })
})
