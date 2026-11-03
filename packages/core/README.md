# @lontar/core

The core of [Lontar](https://github.com/handi7/lontar-cms), an open source, TypeScript-first headless CMS. It holds `defineConfig`, the field definitions and their Zod validation, hooks, access control, the REST API (a Hono app) and the Local API.

```bash
pnpm add @lontar/core @lontar/db-mysql
```

```ts
// lontar.config.ts
import { defineConfig, collection, fields as f } from '@lontar/core'
import { mysqlAdapter } from '@lontar/db-mysql'

const Posts = collection({
  slug: 'posts',
  fields: { title: f.text({ required: true }) },
})

export default defineConfig({
  secret: process.env.LONTAR_SECRET!,
  db: mysqlAdapter({ url: process.env.DATABASE_URL! }),
  collections: [Posts],
})
```

`createLontar(config)` returns a Hono app you can mount in any runtime. `getLontar(config)` gives you the Local API on the server.

See the [main README](https://github.com/handi7/lontar-cms#readme) for the full guide.

## License

MIT
