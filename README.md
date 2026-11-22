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

By default, operations on collections and globals require an authenticated user (`({ user }) => Boolean(user)`). To allow public or anonymous access, define the access rule explicitly (for example, `read: () => true`). A collection's `read`, `update` and `delete` can also return a `where` constraint, see [Row-level access control](#row-level-access-control).

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
  // Pluggable email adapter (development only: logs auth links to stdout; use an email provider like Resend/SendGrid/SES in production)
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

### Row-level access control

A collection's `read`, `update` and `delete` access functions may return a `where` expression instead of a boolean, to limit the operation to the documents it matches:

```ts
const posts = collection({
  slug: 'posts',
  access: {
    read: ({ user }) => (user?.role === 'editor' ? true : { author: { equals: user?.id } }),
    update: ({ user }) => (user?.role === 'editor' ? true : { author: { equals: user?.id } }),
    delete: ({ user }) => user?.role === 'admin',
  },
  fields: { title: f.text(), author: f.text() },
})
```

| Returns          | Meaning                                             |
| ---------------- | --------------------------------------------------- |
| `true`           | Every document.                                     |
| `false`          | No document (`401` without a user, `403` with one). |
| a `where` object | Only the documents that match it.                   |
| a throw          | Denied.                                             |

- The constraint uses the same query language as `where` (operators, `and` / `or`, nested paths such as `seo.title`, relationship ids). It is checked like a request's `where`: a field that does not exist denies the operation. It may name a field the caller cannot read.
- An empty constraint (`{}`, `{ and: [] }`) is denied. Return `true` to allow every document.
- It is combined with the request's own filter as `and`, so a request cannot widen it. Lists, counts and paging only include matching documents.
- A document outside the constraint behaves like one that does not exist: `404` with the same message, for reads, updates, deletes, publish, unpublish, version history, restore and file downloads. `403` is only for a function that returns `false`.
- A related document outside the target collection's constraint is not populated (`null`, or left out of a `hasMany`).
- The constraint is checked against the stored document, not the incoming data or a draft. An update that changes the field it reads can move the document out of the caller's reach once saved; use a `beforeChange` hook or field-level `access.update` to forbid that.
- A constraint on a localized field is evaluated in the request's locale.
- `create`, globals and field-level `access` are boolean only. An object returned from them (or any non-boolean) is denied.
- Webhooks ignore the constraint, as they ignore collection `read` access. The Local API with `overrideAccess: true` (the default) never calls the access function.
- `GET /api/_lontar/permissions` reports a constrained operation as `true` ("at least some documents") with `constrained: { read?, update?, delete? }`. The per-document endpoint answers exactly for that document.
- The constraint check and the write are separate steps, so a concurrent change to the constrained field between them can let a write through.

See [ADR 0030](docs/adr/0030-row-level-access.md) for the full design.

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

### Content localization

Configure multi-language content by declaring `localization` in `defineConfig` and marking fields as `localized: true`:

```ts
export default defineConfig({
  // Global localization config
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'id', label: 'Bahasa Indonesia' },
    ],
    defaultLocale: 'en',
    fallback: true, // fallback to defaultLocale when untranslated (default: true)
  },
  collections: [
    collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true, localized: true }),
        slug: f.slug({ from: 'title', localized: true }),
        content: f.richText({ localized: true }),
        author: f.relationship({ relationTo: 'users' }), // shared across all locales
      },
    }),
  ],
})
```

- **Per-locale storage**: Top-level and flattened `group` fields store values in dedicated per-locale database columns (e.g. `title_en`, `title_id`), preserving native B-tree indexes for `where` filtering and `sort` ordering without join overhead.
- **Unique constraints**: Fields marked `unique: true` and `localized: true` (e.g. `slug`) enforce uniqueness per language (`UNIQUE (slug_en)` and `UNIQUE (slug_id)`).
- **Nested fields**: An entire `array` or `blocks` container can be marked `localized: true` to provide distinct layouts or block counts per language. Alternatively, keep the container shared and mark specific subfields inside rows/blocks as `localized: true`.
- **Relationships and uploads**: Single `relationship` and `upload` fields can be localized to reference language-specific targets. `hasMany` relationships marked `localized: true` maintain independent ordering and item selection per locale.
- **Drafts and versions**: The document entity shares a single `_status` lifecycle. Unpublished translations remain `NULL` in the parent table (triggering fallback), while in-progress draft edits live safely in version snapshots without overwriting drafts in other languages.

See [ADR 0028](docs/adr/0028-localization.md) for full architectural details.

### Live preview

Collections and globals can configure live preview in the admin edit form using a URL template with `{placeholder}` tokens (including `{locale}` for localized collections):

```ts
const Posts = collection({
  slug: 'posts',
  admin: {
    preview: {
      url: 'https://mysite.com/{locale}/posts/{slug}?preview=1',
    },
  },
  fields: {
    title: f.text({ required: true, localized: true }),
    slug: f.slug({ from: 'title' }),
    content: f.richText(),
  },
})
```

The admin renders the target page in a split-screen iframe and transmits unsaved form state in real time over `postMessage`. In your frontend application, use `@lontar/preview` to render instant updates and access the active locale:

```tsx
'use client'
import { useLivePreview } from '@lontar/preview/react'

export function PostView({ post: initialPost }: { post: Post }) {
  const {
    data: post,
    isLive,
    locale,
  } = useLivePreview({
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
  "locale": "id",
  "status": "published",
  "previousStatus": "draft",
  "timestamp": "2026-11-10T12:00:00.000Z"
}
```

- **Payload minimalism**: By default, only structured metadata is sent. Set `includeDoc: true` on the webhook config if your receiver requires the full document snapshot.
- **Locale awareness**: In localized applications, payloads include `"locale"` (e.g. `"id"` or `"all"`). When `includeDoc: true`, the document snapshot is projected to that locale, allowing selective on-demand revalidation per path: `revalidatePath('/' + payload.locale + '/posts/' + payload.doc.slug)` without invalidating unaffected locales.
- **Draft isolation**: Draft saves do not trigger `publish` webhooks. They trigger `update` or `change` webhooks with `status: "draft"`. Autosave never triggers webhooks.
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

### Data-preserving localization migrations

When enabling localization or toggling the `localized` option on fields with existing data, `lontar migrate:create` generates non-destructive, data-preserving migrations:

- **Enabling localization**: Existing data is preserved by moving it into the `defaultLocale` column (e.g. `title` becomes `title_en`), and additional locale columns are added as nullable columns.
- **Toggling localized on or off**: Turning off localization on a field moves the default locale's value into the unlocalized column.
- **Adding locales**: Creates new nullable locale columns without modifying or locking existing rows.
- **Removing locales**: Emits a warning during `migrate:create` before generating `DROP COLUMN` statements, preventing silent data loss.
- **Junction tables**: Localized `hasMany` junction tables automatically backfill existing rows with `defaultLocale` before applying NOT NULL constraints.

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
- `GET /api/_lontar/search?q=<text>&locale=<code>`: Searches every collection the caller can read, by each collection's title field (`admin.useAsTitle`, else its first `text`, `email` or `slug` field, else `filename` for upload collections), with a `contains` match that is escaped like any other `contains` filter. It returns `{ results: [{ id, title, collection, status? }] }`, at most 5 hits per collection and 20 in total, in collection order. A collection the caller cannot read, or whose title field they cannot read, is left out without an error, and a collection with drafts only returns published documents. `locale` picks the language of a localized title and defaults to the default locale; an unknown one is a `400`. A missing or blank `q` returns an empty list. The admin's command palette (⌘K) uses it.

### Extending the admin

> **Target API.** This section is the agreed spec from [ADR 0029](docs/adr/0029-admin-extensibility.md). Each feature lands in its own PR (M12, [#150](https://github.com/handi7/lontar-cms/issues/150)) and this section stays the source of truth until then.

Server code and client code stay on their own sides. They meet through string keys and JSON descriptors in `ClientConfig`, so the admin remains a prebuilt SPA.

#### Custom endpoints

Declare `endpoints` at the root, on a collection, or on a global:

```ts
export default defineConfig({
  endpoints: [
    {
      name: 'pendingStats',
      method: 'get',
      path: '/stats/pending',
      access: ({ user }) => user?.role === 'admin',
      handler: async (c, { lontar }) => {
        const { totalDocs } = await lontar.find('posts', {
          where: { approved: { equals: false } },
          limit: 1,
        })
        return c.json({ pending: totalDocs })
      },
    },
  ],
  collections: [
    collection({
      slug: 'posts',
      endpoints: [
        {
          name: 'approve',
          method: 'post',
          path: '/:id/approve',
          handler: async (c, { lontar, id }) =>
            c.json(await lontar.update('posts', id, { approved: true })),
        },
      ],
      fields: {/* ... */},
    }),
  ],
})
```

| Declared on | Mounted at                        |
| ----------- | --------------------------------- |
| Root        | `<basePath><path>`                |
| Collection  | `<basePath>/<slug><path>`         |
| Global      | `<basePath>/globals/<slug><path>` |

- **Order and reserved paths.** Custom endpoints are registered before the built-in routes. Startup fails, naming the conflict, if a path could overlap a built-in route (a root path starting with a collection slug, `auth`, `globals` or `_lontar`; a collection path starting with `file` or a numeric segment; `/:id/versions`, `/:id/publish`, `/:id/unpublish`).
- **Handler context.** The second argument is `{ user, apiKey, id, locale, config, lontar }`. `id` is parsed from `:id` (`400` if invalid) and `locale` from `?locale`.
- **`lontar` is bound to the caller.** It runs with `overrideAccess: false` and the request's `user`. Pass `overrideAccess: true` explicitly when a handler needs more. This is the opposite of `getLontar()`, which serves trusted server code.
- **`access`** takes the same function as collection access. No user returns `401`, a failing check for a signed-in user returns `403`. Omitting it means any authenticated user; write `access: () => true` for a public endpoint.
- **API keys.** Endpoints are session-only. Set `apiKey: true` to accept an API key; otherwise a key request gets `403`.
- **`rateLimit: { window, max }`** is optional, keyed by client IP and endpoint name. There is no default limit.
- **Path rules.** A path starts with `/`, has no trailing slash, and uses static segments or `:param` names (no wildcards or regular expressions). On a collection, `:id` is the only parameter allowed first and must be followed by a static segment. `name` is unique where the endpoint is declared, and so is each method and path pair.

#### Registering components

Pass React components to `<Admin>` by key, and refer to the key from the config:

```tsx
// app/admin/[[...path]]/page.tsx
'use client'
import { Admin } from '@lontar/admin'

export default function AdminPage() {
  return (
    <Admin
      apiBase="/api"
      basePath="/admin"
      components={{
        'rating-stars': RatingStars,
        'pending-widget': PendingWidget,
        'seo-audit': SeoAuditView,
      }}
    />
  )
}
```

```ts
// lontar.config.ts: strings only, so ClientConfig stays JSON
rating: f.number({ admin: { component: 'rating-stars' } }),

admin: {
  dashboard: { widgets: [{ component: 'pending-widget', width: 'half' }] },
  views: [
    { key: 'seo-audit', label: 'SEO audit', component: 'seo-audit', access: ({ user }) => !!user },
  ],
},
```

`@lontar/admin` exports a props interface for each slot:

- **Field input** (`admin.component` on any field) receives `CustomFieldProps`: `value`, `onChange`, `onBlur`, `path`, `field`, `readOnly`, `locale`, `error`. It replaces the input only. The label, description, conditional display, field-level access and Zod validation stay Lontar's, so a component cannot change what is stored.
- **Dashboard widget** (`admin.dashboard.widgets`) receives `DashboardWidgetProps`. Widgets render in config order.
- **Custom view** (`admin.views`) receives `CustomViewProps`. It is served at `<basePath>/views/<key>` with a sidebar entry. Its `access` function is evaluated by the permissions endpoint and only the boolean reaches the admin. Hiding a view is cosmetic, so the endpoints it calls must enforce access. A collection slug `views` is rejected when `admin.views` is non-empty.

Components read data through exported hooks: `useAdminConfig()`, `useAuth()`, `useLontarFetch()` (fetch bound to `apiBase` with credentials) and `useDocumentForm()` (sibling values, for field components). Anything not exported is private and may change in a minor release.

A key with no registered component renders a placeholder naming the key and logs a warning; the rest of the admin keeps working. To type the keys, augment the empty `AdminComponentKeys` interface from `@lontar/core` by declaration merging. Host components bring their own styles; match the theme with the `--lontar-*` tokens below.

#### Declarative actions

An action binds a button to one of the collection's or global's endpoints, with no client code:

```ts
collection({
  slug: 'posts',
  endpoints: [/* approve, archiveMany */],
  admin: {
    actions: [
      { key: 'approve', label: 'Approve', endpoint: 'approve', scope: ['row', 'document'] },
      {
        key: 'archive',
        label: 'Archive',
        endpoint: 'archiveMany',
        scope: ['bulk'],
        confirm: 'Archive {count} posts?',
        variant: 'destructive',
      },
    ],
  },
  fields: {/* ... */},
})
```

- `row` and `document` actions call the endpoint with `:id` filled in. A `bulk` action sends `POST` with `{ ids: number[] }` to an endpoint without `:id`, and needs list-view row selection.
- On success the admin refreshes the collection and shows a toast. A non-2xx response shows the endpoint's `error` message.
- An action is shown when its endpoint's `access` passes for the current user (called with `{ user }` only). The endpoint re-checks with `id` on every call.
- Set `component` instead of `endpoint` to open a registered component in a dialog, for flows that need input first.
- Startup fails if an action's `endpoint` does not name an endpoint on the same collection or global.

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
- **`storage: 'database'`**: For horizontally scaled deployments, multi-instance clusters, or serverless functions where instances do not share memory. Rate limits are synchronized through the `rateLimit` table generated by `lontar migrate:create` and applied by `lontar migrate`.
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

// Query in a specific locale (defaults to config.localization.defaultLocale)
const { docs: localizedPosts } = await lontar.find('posts', {
  locale: 'id', // 'en' | 'id' | 'all'
  fallbackLocale: 'en', // or false to disable fallback
  where: { slug: { equals: 'tentang-kami' } },
})

// Query modular pages with populated nested relationships and blocks
const { docs: pages } = await lontar.find('pages', {
  where: { slug: { equals: 'about' } },
  depth: 1, // populates hero.backgroundImage, gallery.images[].image, etc.
})
// pages: Page[] with generated layout blocks union
```

The Local API runs with `overrideAccess: true` by default, making server queries straightforward. To enforce access control based on an authenticated user or role, pass `{ overrideAccess: false, user }`. Because `overrideAccess: true` skips read sanitization, documents passed to React Client Components (such as props serialized into RSC payloads) or exposed on public pages should either be fetched with `{ overrideAccess: false, user }` or sanitized using `sanitizeDocRead`. The client also exposes `findByID`, `create`, `update`, `delete`, `publish`, `unpublish`, `findVersions`, `restoreVersion`, `findGlobal`, and `updateGlobal`. Pass `{ draft: true }` to read or modify drafts, and `{ locale, fallbackLocale }` for localized content.

From the browser or other apps, use REST:

```http
GET /api/posts?sort=-publishedAt&limit=10&depth=1
GET /api/posts?locale=id
GET /api/posts?locale=id&fallbackLocale=false
GET /api/posts?locale=all
GET /api/posts?draft=true
GET /api/pages?where[seo.metaTitle][equals]=Home&depth=1
GET /api/posts/:id?locale=id
POST /api/posts?locale=id
PATCH /api/posts/:id?locale=id
POST /api/posts/:id/publish
POST /api/posts/:id/unpublish
GET /api/posts/:id/versions?locale=id
POST /api/posts/:id/versions/:versionId/restore
DELETE /api/posts/:id
GET /api/globals/site-settings?locale=id
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
