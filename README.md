# Lontar

An open source, TypeScript-first headless CMS. Define your schema in a config file and get a REST API, an admin panel, database migrations, and TypeScript types generated for you. The admin is a pure SPA, and the engine runs on Hono, so you can mount it in Next.js, standalone Node, or other runtimes.

> **Status: pre-alpha.** Nothing is implemented yet. This README describes the target API and serves as the spec for v0.1. See [`docs/scope.md`](docs/scope.md) for scope and non-goals.

## Installation

```bash
pnpm add @lontar/core @lontar/db-mysql @lontar/next
pnpm add -D @lontar/cli
```

## Define your config

```ts
// lontar.config.ts
import { defineConfig, collection, global, fields as f } from '@lontar/core'
import { mysqlAdapter } from '@lontar/db-mysql'
import { s3Storage } from '@lontar/storage-s3'

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
    author: f.relationship({ relationTo: 'users' }),
    categories: f.relationship({ relationTo: 'categories', hasMany: true }),
    content: f.richText(),
    publishedAt: f.date(),
  },
  hooks: {
    beforeChange: [({ data }) => {
      if (data.status === 'published' && !data.publishedAt) data.publishedAt = new Date()
      return data
    }],
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
  auth: { collection: 'users' }, // users collection is created automatically
  collections: [Posts, Categories, Media],
  globals: [SiteSettings],
})
```

`fields` is deliberately an object rather than an array, which makes TypeScript type inference simpler.

## Migrations and type generation

```bash
pnpm lontar migrate:create   # diff config against the DB schema, write a migration file
pnpm lontar migrate          # run migrations
pnpm lontar generate:types   # write lontar-types.d.ts
```

## Mount in Next.js

```ts
// app/api/[...lontar]/route.ts
import config from '@/lontar.config'
import { createRouteHandlers } from '@lontar/next'

export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config)
```

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

## Mount in standalone Node

```ts
import { serve } from '@hono/node-server'
import { createLontar } from '@lontar/core'
import config from './lontar.config'

const app = createLontar(config) // a Hono instance
serve({ fetch: app.fetch, port: 3001 })
```

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
```

From the browser or other apps, use REST:

```http
GET /api/posts?where[status][equals]=published&sort=-publishedAt&limit=10&depth=1
GET /api/posts/:id
POST /api/posts
PATCH /api/posts/:id
DELETE /api/posts/:id
GET /api/globals/site-settings
```
