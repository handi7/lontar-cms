# Lontar

An open source, TypeScript-first headless CMS. Define your schema in a config file and get a REST API, an admin panel, database migrations, and TypeScript types generated for you. The admin is a pure SPA, and the engine runs on Hono, so you can mount it in Next.js, standalone Node, or other runtimes.

> **Status: v0.1 ready.** All core features including standard fields, Zod validation, auth, collection-level access control, hooks, globals, rich text (Tiptap), relationships, file uploads (local & S3 storage with Sharp image resizing), type generation, Local API (`getLontar`), and the complete Next.js blog example are implemented. See [`docs/scope.md`](docs/scope.md) for scope and non-goals.

## Installation

```bash
# Using MySQL
pnpm add @lontar/core @lontar/db-mysql @lontar/next @lontar/admin
pnpm add -D @lontar/cli

# Or using PostgreSQL
pnpm add @lontar/core @lontar/db-postgres @lontar/next @lontar/admin
pnpm add -D @lontar/cli
```

> **Note for pnpm 11+:** `@lontar/cli` uses `drizzle-kit` for migrations. If pnpm blocks dependency build scripts (`ERR_PNPM_IGNORED_BUILDS`), run `pnpm approve-builds` or add `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`.

## Define your config

```ts
// lontar.config.ts
import { defineConfig, collection, global, fields as f } from '@lontar/core'
import { mysqlAdapter } from '@lontar/db-mysql'
import { s3Storage } from '@lontar/storage-s3'

const Authors = collection({
  slug: 'authors',
  labels: { singular: 'Author', plural: 'Authors' },
  admin: { useAsTitle: 'name' },
  fields: {
    name: f.text({ required: true }),
    bio: f.textarea(),
  },
})

const Posts = collection({
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'status', 'publishedAt'] },
  access: {
    read: () => true,
    create: ({ user }) => !!user,
    update: ({ user }) => !!user,
    delete: ({ user }) => user?.role === 'admin',
  },
  fields: {
    title: f.text({ required: true, maxLength: 120 }),
    slug: f.slug({ from: 'title', unique: true }),
    status: f.select({ options: ['draft', 'published'], defaultValue: 'draft' }),
    cover: f.upload({ relationTo: 'media' }),
    author: f.relationship({ relationTo: 'authors' }),
    categories: f.relationship({ relationTo: 'categories', hasMany: true }),
    content: f.richText(),
    publishedAt: f.date(),
  },
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (data.status === 'published' && !data.publishedAt) data.publishedAt = new Date()
        return data
      },
    ],
  },
})

const Categories = collection({
  slug: 'categories',
  fields: { name: f.text({ required: true }) },
})

const Media = collection({
  slug: 'media',
  upload: { sizes: { thumb: { width: 400 }, hero: { width: 1600 } } },
  fields: { alt: f.text({ required: true }) },
})

const SiteSettings = global({
  slug: 'site-settings',
  fields: { siteName: f.text(), footerText: f.textarea() },
})

export default defineConfig({
  secret: process.env.LONTAR_SECRET!,
  db: mysqlAdapter({ url: process.env.DATABASE_URL! }),
  storage: s3Storage({ bucket: 'media', endpoint: process.env.S3_ENDPOINT! }),
  collections: [Posts, Categories, Authors, Media],
  globals: [SiteSettings],
})
```

### Database adapters

Lontar supports MySQL and PostgreSQL via dedicated adapters:

- **MySQL**:
  ```ts
  import { mysqlAdapter } from '@lontar/db-mysql'

  db: mysqlAdapter({ url: process.env.DATABASE_URL! })
  ```
- **PostgreSQL**:
  ```ts
  import { postgresAdapter } from '@lontar/db-postgres'

  db: postgresAdapter({ url: process.env.DATABASE_URL! })
  ```

`fields` is deliberately an object rather than an array, which makes TypeScript type inference simpler.

By default, operations on collections and globals require an authenticated user (`({ user }) => Boolean(user)`). To allow public or anonymous access, define the access rule explicitly (for example, `read: () => true`).

### Complex fields (group, array, blocks)

Collections and globals support nested data structures for grouped metadata, repeating items, and modular block layouts:

```ts
import { collection, fields as f, block } from '@lontar/core'

const Pages = collection({
  slug: 'pages',
  fields: {
    title: f.text({ required: true }),
    // Group: 1:1 nested fields, stored as flattened SQL columns (seo__meta_title, etc.)
    seo: f.group({
      label: 'SEO',
      fields: {
        metaTitle: f.text({ maxLength: 70 }),
        metaDescription: f.textarea({ maxLength: 160 }),
        ogImage: f.upload({ relationTo: 'media' }),
      },
    }),
    // Array: 1:N ordered rows of identical fields, stored in a JSON column with stable row IDs
    gallery: f.array({
      label: 'Image Gallery',
      minRows: 0,
      maxRows: 20,
      fields: {
        image: f.upload({ relationTo: 'media', required: true }),
        caption: f.text(),
      },
    }),
    // Blocks: 1:N ordered polymorphic blocks, stored in a JSON column with stable row IDs
    layout: f.blocks({
      label: 'Page Layout',
      minRows: 1,
      maxRows: 50,
      blocks: [
        block({
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: f.text({ required: true }),
            subheading: f.textarea(),
            backgroundImage: f.upload({ relationTo: 'media' }),
          },
        }),
        block({
          slug: 'callToAction',
          labels: { singular: 'Call to Action', plural: 'Calls to Action' },
          fields: {
            text: f.text({ required: true }),
            buttonLabel: f.text({ required: true }),
            buttonUrl: f.text({ required: true }),
          },
        }),
      ],
    }),
  },
})
```

Each item inside an `array` or `blocks` field automatically receives a stable string `id`, ensuring dependable React list keys and accurate version diffing. Nested `relationship` and `upload` fields are populated recursively up to the specified `depth`.

### Conditional fields

Fields can be shown or hidden based on other field values using `admin.condition`. Because `ClientConfig` is plain JSON, conditions are expressed declaratively using the query filter syntax:

```ts
const Posts = collection({
  slug: 'posts',
  fields: {
    format: f.select({
      options: ['standard', 'video', 'quote'],
      defaultValue: 'standard',
    }),
    videoUrl: f.text({
      required: true,
      admin: {
        condition: { format: { equals: 'video' } },
      },
    }),
    quoteAuthor: f.text({
      admin: {
        condition: { format: { equals: 'quote' } },
      },
    }),
  },
})
```

Inside `array` or `blocks` rows, conditions resolve against sibling fields by default, or against top-level document fields using the `$root.` prefix (e.g. `{ '$root.status': { equals: 'published' } }`). Inactive fields are automatically omitted from required validation and cleared on save.

### Drafts and versions

Collections and globals can enable version history and draft publishing workflows:

```ts
const Posts = collection({
  slug: 'posts',
  versions: {
    drafts: true,
    maxPerDoc: 50, // default 50, set 0 for unlimited
  },
  fields: {
    title: f.text({ required: true }),
    content: f.richText(),
  },
})
```

When drafts are enabled:

- Documents gain an engine-managed `_status` system field (`'draft' | 'published'`).
- The parent table always stores the published document (or initial draft if never published), ensuring public reads remain fast single-table queries without version joins.
- Draft edits to an already-published document are stored as version snapshots in `${collection}_versions` until published.
- Queries default to published documents. Pass `draft: true` (requires update access) to read the latest draft state.
- Version history (`/versions`, a single version, and restore) holds draft content, so it requires both read and update access.

### Live preview

Collections and globals can configure live preview in the admin edit form using a URL template with `{placeholder}` tokens:

```ts
const Posts = collection({
  slug: 'posts',
  admin: {
    preview: {
      url: 'https://mysite.com/posts/{slug}?preview=1',
    },
  },
  fields: {
    title: f.text({ required: true }),
    slug: f.slug({ from: 'title' }),
    content: f.richText(),
  },
})
```

The admin renders the target page in a split-screen iframe and transmits unsaved form state in real time over `postMessage`. In your frontend application, use `@lontar/preview` to render instant updates:

```tsx
'use client'
import { useLivePreview } from '@lontar/preview/react'

export function PostView({ post: initialPost }: { post: Post }) {
  const { data: post } = useLivePreview({
    initialData: initialPost,
    serverURL: 'http://localhost:3000',
  })

  return (
    <article>
      <h1>{post.title}</h1>
      <div>{post.content}</div>
    </article>
  )
}
```

### Outgoing webhooks

Notify frontend hosts or external services when content is published, unpublished, changed, or deleted:

```ts
import { collection, defineConfig } from '@lontar/core'

export default defineConfig({
  // Root webhooks matching collections and/or globals
  webhooks: [
    {
      url: 'https://mysite.com/api/revalidate',
      collections: ['posts', 'pages'], // or '*' for all collections
      globals: ['site-settings'], // or '*' for all globals
      events: ['publish', 'unpublish', 'delete'],
      secret: process.env.WEBHOOK_SECRET,
    },
  ],
  collections: [
    collection({
      slug: 'posts',
      // Webhooks can also be configured directly on a collection
      webhooks: [
        {
          url: 'https://mysite.com/api/revalidate',
          events: ['publish', 'unpublish'],
          secret: process.env.WEBHOOK_SECRET,
        },
      ],
      fields: { ... },
    }),
  ],
})
```

#### Event payload & signing

Webhook requests are sent as HTTP `POST` requests with JSON payloads containing event metadata:

```json
{
  "event": "publish",
  "collection": "posts",
  "id": 123,
  "status": "published",
  "previousStatus": "draft",
  "timestamp": "2026-11-10T12:00:00.000Z"
}
```

- **Payload minimalism**: By default, only structured metadata is sent. Set `includeDoc: true` on the webhook config if your receiver requires the full document snapshot.
- **Draft isolation**: Draft saves do not trigger `publish` webhooks. They trigger `update` or `change` webhooks with `status: "draft"`.
- **Post-commit delivery**: Webhooks fire asynchronously in the background strictly after database transactions commit.
- **Failure isolation**: Dead endpoints or network errors retry up to 3 times with exponential backoff and never fail an editor's save.
- **Cryptographic signing**: Requests include `x-lontar-timestamp` (epoch in seconds) and `x-lontar-signature-256` (`sha256=<hex_digest>` computed over `${timestamp}.${body}` to prevent replay attacks).

#### Next.js revalidation receiver example

```ts
// app/api/revalidate/route.ts
import { revalidateTag } from 'next/cache'
import { verifyWebhookSignature, type WebhookPayload } from '@lontar/core'

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-lontar-signature-256') ?? ''
  const timestamp = request.headers.get('x-lontar-timestamp') ?? ''

  const isValid = verifyWebhookSignature({
    payload: rawBody,
    signature,
    secret: process.env.WEBHOOK_SECRET ?? '',
    timestamp,
  })

  if (!isValid) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(rawBody) as WebhookPayload

  if (payload.collection && payload.id) {
    revalidateTag(`${payload.collection}-${payload.id}`)
    revalidateTag(payload.collection)
  } else if (payload.global) {
    revalidateTag(payload.global)
  }

  return Response.json({ revalidated: true, now: Date.now() })
}
```

### Lifecycle hooks

Collections and globals support lifecycle hooks for input normalization, validation, audit logging, side effects, and cleanup:

| Hook             | When it runs                   | Can mutate data               | Can abort        | Transactional context                          |
| ---------------- | ------------------------------ | ----------------------------- | ---------------- | ---------------------------------------------- |
| `beforeValidate` | Before Zod schema validation   | Yes (returns modified data)   | Yes (throws)     | Pre-validation                                 |
| `beforeChange`   | Before writing to the database | Yes (returns modified data)   | Yes (throws)     | Inside write transaction                       |
| `afterChange`    | After writing to the database  | Yes (returns modified doc)    | Yes (throws)     | Inside write transaction (rolls back on throw) |
| `beforeDelete`   | Before deleting from database  | No                            | Yes (throws)     | Inside delete transaction                      |
| `afterDelete`    | After deleting from database   | Yes (returns modified doc)    | No (post-commit) | After transaction commit                       |
| `afterRead`      | After reading a document       | Yes (returns transformed doc) | Yes (throws)     | Read operation                                 |

#### Hook arguments

- **`beforeValidate` / `beforeChange`**: `({ data, req, operation, originalDoc, status, previousStatus, statusTransition })`
- **`afterChange`**: `({ doc, previousDoc, req, operation, status, previousStatus, statusTransition })`
- **`beforeDelete`**: `({ id, doc, req, status })`
- **`afterDelete`**: `({ id, doc, req, status })`
- **`afterRead`**: `({ doc, req })`

When `versions: { drafts: true }` is enabled, `beforeChange` and `afterChange` run on both draft saves and publishes. Use `statusTransition === 'publish'` to guard external side effects like sending emails or triggering external builds.

```ts
const Posts = collection({
  slug: 'posts',
  fields: { title: f.text({ required: true }) },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (typeof data.title === 'string') {
          data.title = data.title.trim()
        }
        return data
      },
    ],
    beforeDelete: [
      ({ doc }) => {
        if (doc.locked) {
          throw new Error('Cannot delete locked document')
        }
      },
    ],
    afterDelete: [
      async ({ doc }) => {
        await purgeExternalCache(doc.id)
      },
    ],
  },
})
```

## Migrations and type generation

The CLI works with both MySQL (`@lontar/db-mysql`) and PostgreSQL (`@lontar/db-postgres`), detecting the configured adapter's dialect automatically:

```bash
pnpm lontar migrate:create   # diff config against the DB schema, write a migration file
pnpm lontar migrate          # run migrations
pnpm lontar generate:types   # write lontar-types.ts
```

## Mount in Next.js

```ts
// app/api/[...lontar]/route.ts
import config from '@/lontar.config'
import { createRouteHandlers } from '@lontar/next'

export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config, {
  baseURL: process.env.LONTAR_URL, // e.g. http://localhost:3000
})
```

`baseURL` is the public origin of your app. Better Auth uses it for auth redirects and to check request origins. If you leave it out, Better Auth falls back to the `BETTER_AUTH_URL` environment variable, and without either it logs a "Base URL is not set" warning on every request. Set it to the URL users reach the app at, including behind a proxy.

```tsx
// app/admin/[[...path]]/page.tsx
'use client'
import { Admin } from '@lontar/admin'
import '@lontar/admin/styles.css'

export default function AdminPage() {
  return <Admin apiBase="/api" basePath="/admin" />
}
```

On load, the admin fetches the `ClientConfig` from `/api/_lontar/config` and renders lists and forms from it.

### Admin theming

The CSS custom properties below are the supported theming surface. Override them on
`.lontar-admin` in a stylesheet loaded after `@lontar/admin/styles.css`:

```css
.lontar-admin {
  --lontar-primary: #2563eb;
  --lontar-primary-hover: #1d4ed8;
  --lontar-primary-text: #ffffff;
  --lontar-radius: 8px;
}
```

The defaults are defined in [`packages/admin/src/styles.css`](packages/admin/src/styles.css).

| Token                     | Light     | Dark      | Purpose                                |
| ------------------------- | --------- | --------- | -------------------------------------- |
| `--lontar-bg`             | `#f8fafc` | `#020617` | Admin background                       |
| `--lontar-surface`        | `#ffffff` | `#0f172a` | Panels, cards, and input backgrounds   |
| `--lontar-surface-hover`  | `#f1f5f9` | `#1e293b` | Hovered surfaces and muted backgrounds |
| `--lontar-border`         | `#e2e8f0` | `#1e293b` | Borders and separators                 |
| `--lontar-text`           | `#0f172a` | `#f8fafc` | Main text                              |
| `--lontar-text-muted`     | `#64748b` | `#94a3b8` | Secondary text                         |
| `--lontar-primary`        | `#0f172a` | `#f8fafc` | Primary actions and accents            |
| `--lontar-primary-hover`  | `#1e293b` | `#e2e8f0` | Hovered primary actions                |
| `--lontar-primary-text`   | `#ffffff` | `#0f172a` | Text on primary actions                |
| `--lontar-danger`         | `#ef4444` | `#f87171` | Destructive actions and invalid fields |
| `--lontar-danger-hover`   | `#dc2626` | `#ef4444` | Hovered destructive actions            |
| `--lontar-success-bg`     | `#ecfdf5` | `#052e16` | Success message background             |
| `--lontar-success-border` | `#a7f3d0` | `#166534` | Success message border                 |
| `--lontar-success-text`   | `#065f46` | `#86efac` | Success message text                   |
| `--lontar-error-bg`       | `#fef2f2` | `#450a0a` | Error message background               |
| `--lontar-error-border`   | `#fecaca` | `#7f1d1d` | Error message border                   |
| `--lontar-error-text`     | `#991b1b` | `#fca5a5` | Error message text                     |
| `--lontar-radius`         | `6px`     | same      | Base corner radius                     |

#### Dark mode

The admin follows the operating system's light or dark preference by default. Editors
can override it with the Light / Dark / System switch at the bottom of the sidebar. The
choice is stored in the browser's `localStorage` under `lontar-admin-theme`, and an
explicit choice sets `data-theme="light"` or `data-theme="dark"` on the `.lontar-admin`
wrapper. See [ADR 0020](docs/adr/0020-admin-dark-mode.md).

Colour overrides on `.lontar-admin` apply to the light theme only. The dark theme's selectors
are more specific, so a light colour never ends up on a dark background. `--lontar-radius`
has no dark value, so overriding it changes both themes. To change the dark colours too,
override the same tokens on both dark selectors:

```css
.lontar-admin[data-theme='dark'] {
  --lontar-primary: #60a5fa;
  --lontar-primary-hover: #93c5fd;
  --lontar-primary-text: #020617;
}

@media (prefers-color-scheme: dark) {
  .lontar-admin:not([data-theme='light']) {
    --lontar-primary: #60a5fa;
    --lontar-primary-hover: #93c5fd;
    --lontar-primary-text: #020617;
  }
}
```

Internal class names and any utility prefix are implementation details, not supported
theming APIs. Use the tokens rather than targeting individual admin components.

## Mount in standalone Node

```ts
import { serve } from '@hono/node-server'
import { createLontar } from '@lontar/core'
import config from './lontar.config'

const app = createLontar(config, { baseURL: process.env.LONTAR_URL }) // a Hono instance
serve({ fetch: app.fetch, port: 3001 })
```

`createLontar` takes the same `baseURL` option as `createRouteHandlers`. Here that would be `http://localhost:3001` in development.

## Querying from the frontend

On the server (RSC, route handlers, scripts), use the Local API with no HTTP round trip:

```ts
import { getLontar } from '@lontar/core'
import config from '@/lontar.config'

const lontar = await getLontar(config)

const { docs, totalDocs } = await lontar.find('posts', {
  where: { status: { equals: 'published' } },
  sort: '-publishedAt',
  limit: 10,
  depth: 1, // populate author, categories, cover
})
// docs: Post[] with generated types

// Query modular pages with populated nested relationships and blocks
const { docs: pages } = await lontar.find('pages', {
  where: { slug: { equals: 'about' } },
  depth: 1, // populates hero.backgroundImage, gallery.images[].image, etc.
})
// pages: Page[] with generated layout blocks union
```

The Local API runs with `overrideAccess: true` by default, making server queries straightforward. To enforce access control based on an authenticated user or role, pass `{ overrideAccess: false, user }`. The client also exposes `findByID`, `create`, `update`, `delete`, `publish`, `unpublish`, `findVersions`, `restoreVersion`, `findGlobal`, and `updateGlobal`. Pass `{ draft: true }` to read or modify drafts.

From the browser or other apps, use REST:

```http
GET /api/posts?sort=-publishedAt&limit=10&depth=1
GET /api/posts?draft=true
GET /api/pages?where[seo.metaTitle][equals]=Home&depth=1
GET /api/posts/:id
POST /api/posts
PATCH /api/posts/:id
POST /api/posts/:id/publish
POST /api/posts/:id/unpublish
GET /api/posts/:id/versions
POST /api/posts/:id/versions/:versionId/restore
DELETE /api/posts/:id
GET /api/globals/site-settings
POST /api/globals/site-settings/publish
```

## License

[MIT](LICENSE)
