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

### Users and roles

Configure roles and user defaults via the `auth` option in `defineConfig`:

```ts
export default defineConfig({
  auth: {
    roles: ['admin', 'editor', 'author'] as const,
    defaultRole: 'editor',
    adminRole: 'admin',
  },
  // ...
})
```

- `roles`: Allowed role strings. Defaults to `['admin', 'editor']`.
- `defaultRole`: Assigned to newly invited or created users (defaults to `'editor'`).
- `adminRole`: Privileged role permitted to manage users, roles, and administrative settings (defaults to `'admin'`).

Access rules on collections and fields receive `{ user }`, with `user.role` typed from the configured roles:

```ts
const Posts = collection({
  slug: 'posts',
  access: {
    read: () => true,
    create: ({ user }) => Boolean(user),
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin',
  },
  // ...
})
```

See [ADR 0026](docs/adr/0026-users-and-roles.md) for full details on the auth data model.

### Email delivery, password reset, and user invites

Configure a pluggable email adapter in `defineConfig` to enable password reset requests, user invitations, and email verification:

```ts
import { consoleEmailAdapter, defineConfig } from '@lontar/core'

export default defineConfig({
  // Pluggable email adapter (console logger for dev/testing, or custom provider like Resend/SendGrid/SES)
  email: consoleEmailAdapter(),

  // Optional: customize sender or templates
  // email: {
  //   adapter: customEmailAdapter,
  //   from: 'Lontar CMS <no-reply@myproject.com>',
  //   templates: {
  //     invite: ({ user, url }) => ({
  //       subject: `You're invited to join ${user.name}`,
  //       text: `Accept your invitation: ${url}`,
  //     }),
  //   },
  // },

  auth: {
    roles: ['admin', 'editor', 'author'] as const,
    defaultRole: 'editor',
    adminRole: 'admin',
    requireEmailVerification: false, // Optional: require email verification on sign-up
  },
  // ...
})
```

When an email adapter is configured:

- **Forgot password**: The admin login page displays a "Forgot password?" link where users can request a password reset email (`POST /api/auth/request-password-reset`).
- **User invitations**: In the Users administration view, admins can invite team members with a specific role without setting an initial password (`invite: true`). Invited users receive an activation link (`/accept-invite?token=...`) to set their own password.
- **Resend invitations**: Administrators can resend invitation links at any time directly from the user actions menu (`POST /api/_lontar/users/:id/resend-invite`).
- **Without an adapter**: When `email` is not configured, reset and invite features are gracefully hidden in the admin UI, and invite endpoints return clear `400` errors.

### Field-level access control

Fields also support granular `access` functions (`read`, `create`, `update`):

```ts
const Posts = collection({
  slug: 'posts',
  fields: {
    title: f.text({ required: true }),
    content: f.richText(),
    // Hidden from unauthorized users in API responses and admin UI
    editorialNotes: f.textarea({
      access: {
        read: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
        create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
        update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
      },
    }),
    // Readable by anyone, but writable only by administrators
    views: f.number({
      defaultValue: 0,
      access: {
        read: () => true,
        create: ({ user }) => user?.role === 'admin',
        update: ({ user }) => user?.role === 'admin',
      },
    }),
  },
})
```

Fields without read access are omitted from API responses, populated relationships, and version history. Filters and sorts on unreadable fields are rejected to prevent oracle attacks. See [ADR 0027](docs/adr/0027-field-level-access.md) for full details.

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

### Admin endpoints

Lontar serves internal endpoints under `/api/_lontar/` consumed by the admin panel:

- `GET /api/_lontar/config`: Returns the serialized `ClientConfig` (collections, globals, field definitions without server functions).
- `GET /api/_lontar/me`: Returns the current session and authenticated user (`{ user, session }`).
- `GET /api/_lontar/permissions` (alias: `GET /api/_lontar/access`): Returns collection- and global-level permissions (`create`, `read`, `update`, `delete`, `readVersions`) and field-level permissions (`{ read, create, update }`) for the current caller (including anonymous visitors, restricted roles, and administrators).
- `GET /api/_lontar/permissions/:collection/:id` (alias: `GET /api/_lontar/access/:collection/:id`): Returns document-specific permissions, including dynamic and row-conditional field permissions for `group`, `array`, and `blocks` fields.

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

### Rate limiting & multi-instance deployments

Authentication endpoints and sensitive operations are protected against brute-force attacks by rate limiting based on client IP:

- **Sign-in** (`/api/auth/sign-in/*`): 5 requests per 60 seconds.
- **Password reset** (`/api/auth/request-password-reset`, `/api/auth/reset-password`): 3–5 requests per 60 seconds.
- **First user setup** (`POST /api/_lontar/first-user`): 5 requests per 60 seconds.
- **User invites** (`POST /api/_lontar/users` with invite, `POST /api/_lontar/users/:id/resend-invite`): 10 requests per 60 seconds.
- **Failed API key attempts**: 5 failures per 60 seconds per IP (valid API key requests are not limited).

Rate limiting is **enabled by default in production** (`NODE_ENV === 'production'`) and automatically disabled in test and E2E environments (`NODE_ENV === 'test'`, `PLAYWRIGHT === 'true'`, or `DISABLE_AUTH_RATE_LIMIT === 'true'`).

When a rate limit is exceeded, the server responds with HTTP `429 Too Many Requests` and standard `Retry-After` (and `X-Retry-After`) headers indicating how many seconds to wait. The admin panel surfaces a friendly countdown message ("Too many login attempts. Please try again in X seconds.").

#### Storage options

Both `createRouteHandlers` and `createLontar` accept a `rateLimit` configuration:

```ts
export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config, {
  baseURL: process.env.LONTAR_URL,
  rateLimit: {
    // 'memory' (default) or 'database'
    storage: 'database',
  },
})
```

- **`storage: 'memory'` (default)**: Fast, in-process rate limiting suitable for single-process deployments and local development.
- **`storage: 'database'`**: For horizontally scaled deployments, multi-instance clusters, or serverless functions where instances do not share memory. Rate limits are synchronized through the `rateLimit` table generated by `lontar migrate`.
- **`customStorage`**: A custom store implementing `{ consume(key, rule): Promise<{ allowed: boolean, retryAfter: number | null }> }` (such as Redis or Memcached).

#### Reverse proxies & client IP resolution

To prevent client IP spoofing attacks, forwarded IP headers (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`) are **not trusted by default**.

When deploying behind a reverse proxy, load balancer, or CDN (such as Nginx, Cloudflare, Traefik, or AWS ALB), configure `trustedProxies` or `ipAddressHeaders` on `createRouteHandlers` / `createLontar`, or set the `TRUSTED_PROXIES` and `IP_ADDRESS_HEADERS` environment variables:

```ts
export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config, {
  baseURL: process.env.LONTAR_URL,
  // List of trusted proxy CIDRs / IPs (walks X-Forwarded-For backwards to real client IP)
  trustedProxies: ['127.0.0.1', '10.0.0.0/8'],
  // Or specify trusted forwarded headers directly:
  // ipAddressHeaders: ['cf-connecting-ip'],
})
```

- **`trustedProxies`**: Array of trusted proxy IP addresses or CIDR blocks (e.g. `['127.0.0.1', '10.0.0.0/8']`, or via `TRUSTED_PROXIES`). When set, `X-Forwarded-For` is safely traversed backwards from the edge proxy to resolve the first untrusted upstream client IP.
- **`ipAddressHeaders`**: Array of request header names in priority order to inspect for client IP (e.g. `['cf-connecting-ip']` for Cloudflare, or via `IP_ADDRESS_HEADERS`).

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

The Local API runs with `overrideAccess: true` by default, making server queries straightforward. To enforce access control based on an authenticated user or role, pass `{ overrideAccess: false, user }`. Because `overrideAccess: true` skips read sanitization, documents passed to React Client Components (such as props serialized into RSC payloads) or exposed on public pages should either be fetched with `{ overrideAccess: false, user }` or sanitized using `sanitizeDocRead`. The client also exposes `findByID`, `create`, `update`, `delete`, `publish`, `unpublish`, `findVersions`, `restoreVersion`, `findGlobal`, and `updateGlobal`. Pass `{ draft: true }` to read or modify drafts.

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

### API keys for machine-to-machine access

For external servers, cron jobs, and background workers that need to query or mutate content without browser cookies, generate an API key from the **Account** page in the admin panel.

API keys are owned by a user and act on behalf of that user. Requests made with an API key enforce the user's role and all collection- and field-level access control functions.

Pass the key using either `Authorization: Bearer <key>` or the `x-api-key` header:

```ts
// Using Authorization: Bearer
const response = await fetch('https://example.com/api/posts', {
  headers: {
    Authorization: `Bearer ${process.env.LONTAR_API_KEY}`,
  },
})
const data = await response.json()
```

```bash
# Using x-api-key header
curl -X GET https://example.com/api/posts \
  -H "x-api-key: lt_abcdef123456..."
```

API keys:

- Are displayed once upon creation and stored securely hashed (SHA-256).
- Support optional expiration times and track `lastUsedAt`.
- Stop working immediately if revoked or if the owning user account is disabled. If an account is re-enabled, its unexpired keys become active again; to permanently cut off access for a compromised account, revoke its keys individually or delete the account.
- Changing or resetting a user's password revokes active browser sessions but does not revoke their API keys.
- Cannot be used to access user management, profile updates, or API key endpoints (`/_lontar/users*`, `PATCH /_lontar/me`, `POST /_lontar/me/password`, `/_lontar/api-keys*`). These are interactive, session-only operations and return `403 Forbidden` when requested with an API key.
- Do not affect the Local API (`getLontar`), which executes directly within the host runtime.

## License

[MIT](LICENSE)
