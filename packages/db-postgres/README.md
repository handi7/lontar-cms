# @lontar/db-postgres

PostgreSQL database adapter for [Lontar](https://github.com/handi7/lontar-cms), built on Drizzle ORM and `pg`. It maps collections and globals to PostgreSQL tables, handles nested `jsonb` querying, row locking, transactional writes, and backs the `lontar migrate` commands.

## Installation

```bash
pnpm add @lontar/db-postgres
```

## Usage

```ts
import { defineConfig } from '@lontar/core'
import { postgresAdapter } from '@lontar/db-postgres'

export default defineConfig({
  secret: process.env.LONTAR_SECRET!,
  db: postgresAdapter({
    url: process.env.DATABASE_URL!,
    // Optional connection pool options forwarded to pg.Pool:
    pool: {
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  }),
  // collections, globals, storage...
})
```

## Options

`postgresAdapter` accepts an options object:

| Option        | Type                                           | Description                                                                                                                                          |
| :------------ | :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`         | `string`                                       | **Required.** PostgreSQL connection string (e.g. `postgres://user:password@localhost:5432/dbname` or SSL URL like `postgres://...?sslmode=require`). |
| `pool`        | `pg.PoolConfig`                                | Optional configuration object forwarded directly to `pg.Pool` (`max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, `ssl`, etc.).                  |
| `onPoolError` | `(err: Error, client?: pg.PoolClient) => void` | Optional callback invoked when an idle client in the connection pool encounters an error. By default, logs to `console.error`.                       |

## Features & Dialect Differences

- **Native JSONB**: Complex fields (`array`, `blocks`, and version snapshots) are stored as binary `jsonb` with PostgreSQL containment (`@>`) and JSON path querying.
- **Timestamps**: Date fields and system timestamps use `timestamp with time zone` (`timestamptz(3)`) normalized to UTC.
- **Row Locking**: Document publishing and version retention utilize `SELECT ... FOR UPDATE` for concurrent transactional integrity.
- **Case-Insensitive Search**: Text queries (`like`, `contains`) compile to PostgreSQL's `ILIKE` operator for consistent cross-database semantics with MySQL.

Requires `@lontar/core` as a peer dependency. See the [main README](https://github.com/handi7/lontar-cms#readme) for the full guide.

## License

MIT
