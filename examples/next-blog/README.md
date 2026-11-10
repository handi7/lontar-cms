# Next.js Blog Example with Lontar CMS

A complete real-world Next.js App Router blog demonstrating Lontar CMS integration, standard and complex fields, drafts and version history, real-time live preview, and on-demand cache revalidation.

## Features

- **Embedded CMS**: Lontar Admin mounted at `/admin`, REST API and Better Auth at `/api`.
- **Collections & Globals**:
  - `posts`: Blog articles with rich text, categories, author relationships, responsive image uploads, and drafts (`versions: { drafts: true }`).
  - `pages`: Dynamic marketing pages built with polymorphic content blocks (`hero`, `richText`, `gallery`, `callToAction`).
  - `categories` & `authors`: Taxonomies and relationship targets.
  - `media`: Image uploads with Sharp thumbnail and hero image variants.
  - `site-settings`: Global single-document configuration.
- **Milestone 8 Drafts & Versions**:
  - Native `_status` system field (`draft` | `published`).
  - Document sidebar with Draft and Publish controls, version history compare and restore, and autosave.
  - **Live Preview**: Configured via `admin.preview: { url: '/posts/{slug}?preview=1' }`. The preview iframe connects using `@lontar/preview/react`'s `useLivePreview` hook, updating content in real time as editors type.
  - **On-Demand Cache Revalidation**: Outgoing webhooks in `lontar.config.ts` target `/api/revalidate`. On publish or unpublish events, HMAC-SHA256 signatures are verified using `verifyWebhookSignature` from `@lontar/core`, and Next.js revalidates cached routes via `revalidatePath` and `revalidateTag`.

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker (for MySQL database)

## Getting Started

1. **Start MySQL database:**

   ```bash
   pnpm db:up
   ```

2. **Apply database migrations:**

   ```bash
   pnpm --filter next-blog migrate
   ```

3. **Start development server:**

   ```bash
   pnpm --filter next-blog dev
   ```

4. **Access the application:**
   - Public Blog: [http://localhost:3000](http://localhost:3000)
   - Admin Panel: [http://localhost:3000/admin](http://localhost:3000/admin)

5. **First-time Onboarding:**
   - Visiting `/admin` will prompt you to create the initial admin user account.

## Verifying Drafts, Preview & Revalidation

1. In `/admin`, create a post and click the dropdown next to **Publish** -> select **Save Draft**.
2. Visit [http://localhost:3000](http://localhost:3000) or `http://localhost:3000/posts/<slug>` as a regular visitor:
   - The draft post is absent from the homepage and returns a 404 on the direct route.
3. In `/admin`, open the draft post and click **Live Preview**:
   - The preview pane opens an iframe displaying the draft post with a "Draft Preview" badge.
   - Typing into the title or rich text editor updates the preview instantly.
4. Click **Publish**:
   - Lontar dispatches an outgoing webhook to `/api/revalidate`.
   - The post immediately becomes accessible on the public homepage and detail view.
5. In `/admin`, open the publishing dropdown and select **Unpublish**:
   - The post reverts to draft status and disappears from public view.

## Running Tests

Run the full end-to-end Playwright suite:

```bash
pnpm --filter next-blog test:e2e
```
