# @lontar/db-mysql

MySQL database adapter for [Lontar](https://github.com/handi7/lontar-cms), built on Drizzle ORM. It maps collections and globals to tables and backs the `lontar migrate` commands.

```bash
pnpm add @lontar/db-mysql
```

```ts
import { defineConfig } from '@lontar/core'
import { mysqlAdapter } from '@lontar/db-mysql'

export default defineConfig({
  db: mysqlAdapter({ url: process.env.DATABASE_URL! }),
  // ...
})
```

Requires `@lontar/core` as a peer dependency. See the [main README](https://github.com/handi7/lontar-cms#readme) for the full guide.

## License

MIT
