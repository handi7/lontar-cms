# Lontar

An open source, TypeScript-first headless CMS. Define your schema in a config file and get a REST API, an admin panel, database migrations, and TypeScript types generated for you. The admin is a pure SPA, and the engine runs on Hono, so you can mount it in Next.js, standalone Node, or other runtimes.

> **Status: v0.1 ready.** All core features including standard fields, Zod validation, auth, collection-level access control, hooks, globals, rich text (Tiptap), relationships, file uploads (local & S3 storage with Sharp image resizing), type generation, Local API (`getLontar`), and the complete Next.js blog example are implemented. See [`docs/scope.md`](docs/scope.md) for scope and non-goals.

## Installation

```bash
pnpm add @lontar/core @lontar/db-mysql @lontar/next @lontar/admin
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

## Migrations and type generation

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

The Local API runs with `overrideAccess: true` by default, making server queries straightforward. To enforce access control based on an authenticated user or role, pass `{ overrideAccess: false, user }`. The client also exposes `findByID`, `create`, `update`, `delete`, `findGlobal`, and `updateGlobal`.

From the browser or other apps, use REST:

```http
GET /api/posts?where[status][equals]=published&sort=-publishedAt&limit=10&depth=1
GET /api/pages?where[seo.metaTitle][equals]=Home&depth=1
GET /api/posts/:id
POST /api/posts
PATCH /api/posts/:id
DELETE /api/posts/:id
GET /api/globals/site-settings
```

## License

[MIT](LICENSE)
