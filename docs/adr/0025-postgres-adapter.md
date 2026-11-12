# 0025: PostgreSQL adapter, driver selection, and dialect differences

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Lontar's database abstraction was designed in [ADR 0002](0002-drizzle-mysql-adapter.md) around an adapter interface defined in `packages/core` (`DatabaseAdapter`), with `packages/db-mysql` as the initial implementation for v0.1.

ADR 0002 explicitly cautioned:

> "The adapter interface also has to stay genuinely database-agnostic while having exactly one implementation, which is the condition under which abstractions quietly grow MySQL-shaped. Reviewing the interface against a second database before v0.2 is worth doing deliberately."

Milestone 9 introduces the second database adapter: **PostgreSQL** ([#147](https://github.com/handi7/lontar-cms/issues/147)). Adding PostgreSQL fulfills the most requested production database requirement and proves the adapter interface abstraction. Furthermore, because Milestone 7 (Complex fields: `group`, `array`, `blocks` via [ADR 0021](0021-nested-field-storage.md)) and Milestone 8 (Drafts, versions, and live preview via [ADR 0023](0023-version-storage-and-drafts.md)) are complete, the PostgreSQL adapter must handle nested JSON filtering, version snapshots, document locking, and transactional writes from day one.

Before implementing `@lontar/db-postgres`, we must define:

1. Why PostgreSQL first and SQLite later.
2. The Node.js driver and Drizzle integration package.
3. Column type mapping per field type, resolving dialect differences (such as VARCHAR length ceilings, timezone handling, and JSON columns).
4. Translation of nested JSON filters and case sensitivity rules for query consistency.
5. Database error mapping onto `UniqueConstraintError` and `DatabaseError`.
6. Interface additions to `DatabaseAdapter` to remove MySQL assumptions from core and CLI.
7. Boundaries for shared code versus per-adapter code.
8. Migration workflow and switching adapters.

---

## Decision

### 1. PostgreSQL First, SQLite Later

- **PostgreSQL First**:
  - PostgreSQL is the industry-standard relational database for production Node.js and TypeScript backends.
  - Native `jsonb` supports binary decomposition, GIN indexes, existence/containment operators (`@>`, `?`), and JSON path queries, matching the requirements of ADR 0021 for nested arrays and blocks.
  - Native support for row-level locking via `SELECT ... FOR UPDATE` aligns with Lontar's draft publishing, version pruning, and transactional concurrency controls (ADR 0009, ADR 0023).
- **SQLite Later**:
  - SQLite is valuable for zero-setup local development and embedded edge runtimes, but introduces fundamental differences:
    - No native row-level locks (`SELECT ... FOR UPDATE` is unsupported; concurrency relies on SQLite file/WAL-level locks).
    - Severely restricted `ALTER TABLE` capabilities in migrations (often requiring table recreation).
    - JSON is stored as unindexed text with JSON1 extension functions.
  - Deferring SQLite allows proving multi-database support on two full-featured SQL engines first.

### 2. Package and Driver Selection

- **Package**: `@lontar/db-postgres`.
- **Driver**: `pg` (`node-postgres`) with `@types/pg`, driven through `drizzle-orm/node-postgres`.
- **Why `pg` over `postgres-js`**:
  - `pg` is the most widely adopted and battle-tested PostgreSQL client in the Node.js ecosystem.
  - Better Auth provides first-class support for `pg` via its Drizzle adapter (`drizzleAdapter(db, { provider: 'pg' })`).
  - Broadest compatibility with managed database connection poolers (PgBouncer in transaction mode), AWS RDS IAM authentication, Unix domain sockets, and enterprise SSL/TLS certificate configurations.
  - Connection pooling architecture (`pg.Pool`) mirrors `mysql2`'s `mysql.createPool`, providing predictable connection management, graceful teardown, and integration test database isolation.

### 3. Column Mapping per Field Type

| Lontar Field Type          | MySQL Column (`@lontar/db-mysql`)       | PostgreSQL Column (`@lontar/db-postgres`)                                              | Notes                                                                                     |
| :------------------------- | :-------------------------------------- | :------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `id` (system)              | `int().autoincrement().primaryKey()`    | `serial('id').primaryKey()`                                                            | PostgreSQL sequence-backed integer ID.                                                    |
| `createdAt` / `updatedAt`  | `timestamp().defaultNow().notNull()`    | `timestamp({ precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull()` | Stored with timezone (`timestamptz(3)`) to maintain UTC consistency (ADR 0010).           |
| `text`                     | `varchar({ length: maxLength ?? 255 })` | `varchar({ length: maxLength ?? 255 })`                                                | Max length constraint applied when defined; defaults to 255.                              |
| `textarea`                 | `text()`                                | `text()`                                                                               | Arbitrary length text in both dialects.                                                   |
| `number` (integer)         | `int()`                                 | `integer()`                                                                            | 32-bit signed integer.                                                                    |
| `number` (float)           | `double()`                              | `doublePrecision()`                                                                    | IEEE 754 double precision float.                                                          |
| `checkbox`                 | `boolean()` (`tinyint(1)`)              | `boolean()`                                                                            | Native PostgreSQL boolean type (`true` / `false`).                                        |
| `select` (single)          | `varchar({ length: 120 })`              | `varchar({ length: 120 })`                                                             | String option slug.                                                                       |
| `select` (`hasMany`)       | `json()`                                | `jsonb()`                                                                              | Stored as JSON array of selected string keys.                                             |
| `date`                     | `datetime({ fsp: 3, mode: 'date' })`    | `timestamp({ precision: 3, withTimezone: true, mode: 'date' })`                        | See _Date and Timezone Handling_ below.                                                   |
| `email`                    | `varchar({ length: 255 })`              | `varchar({ length: 255 })`                                                             | Supports unique index.                                                                    |
| `slug`                     | `varchar({ length: 255 })`              | `varchar({ length: 255 })`                                                             | Supports unique index.                                                                    |
| `richText`                 | `json()`                                | `jsonb()`                                                                              | Structured Tiptap document tree.                                                          |
| `relationship` (single)    | `int()`                                 | `integer()`                                                                            | Foreign ID to target collection document.                                                 |
| `relationship` (`hasMany`) | Junction table                          | Junction table                                                                         | Schema: `serial('id')`, `integer('parentId')`, `integer('targetId')`, `integer('order')`. |
| `upload`                   | `int()`                                 | `integer()`                                                                            | Foreign ID referencing upload collection.                                                 |
| `group`                    | Flattened columns (`${group}__${sub}`)  | Flattened columns (`${group}__${sub}`)                                                 | 1:1 mapped columns, preserves native SQL types and indexes.                               |
| `array` / `blocks`         | `json()`                                | `jsonb()`                                                                              | Stored as JSON array of rows with stable `id`s (ADR 0021).                                |
| `_status` (system)         | `varchar('_status', { length: 20 })`    | `varchar('_status', { length: 20 })`                                                   | `'draft'` or `'published'`.                                                               |
| `_versions` snapshot       | `json('snapshot')`                      | `jsonb('snapshot')`                                                                    | Full document snapshot for version history.                                               |

#### Date and Timezone Handling

- In MySQL, `DATETIME(3)` has no timezone component; ADR 0010 enforced UTC consistency by configuring the MySQL connection pool with `timezone: 'Z'`.
- In PostgreSQL, user date fields and system audit timestamps use `timestamp with time zone` (`timestamptz(3)` via Drizzle `timestamp({ precision: 3, withTimezone: true, mode: 'date' })`).
- `timestamptz` stores absolute UTC timestamps internally and formats them based on session timezone. Configuring the `pg.Pool` connection with UTC (`SET timezone = 'UTC'`) guarantees that Date instances and ISO strings round-trip without offset drift across client, server, and database.

#### String Length Limits (ADR 0013)

- In MySQL InnoDB, `VARCHAR` columns share a row-wide 65,535-byte limit, capping any single column at 16,383 characters in `utf8mb4` (ADR 0013).
- In PostgreSQL, `varchar(n)` accepts up to 10,485,760 characters, and `text` has no length restriction.
- Rather than core hardcoding MySQL's 16,383 limit in `defineConfig`, the adapter exposes its maximum string length capability.

### 4. Nested-Field Queries and Dialect Translation

To satisfy the contract defined in ADR 0021 and ADR 0012, `@lontar/db-postgres` translates Lontar query filters into PostgreSQL `jsonb` expressions:

#### Case-Insensitive Pattern Matching (`like`, `contains`)

- MySQL default collations (`utf8mb4_0900_ai_ci` or `utf8mb4_unicode_ci`) evaluate `LIKE` case-insensitively.
- PostgreSQL `LIKE` is case-sensitive by default.
- **Decision**: In `@lontar/db-postgres`, the `like` and `contains` operators compile to PostgreSQL's `ILIKE` operator. This ensures identical query semantics on both databases: `{ where: { title: { like: 'hello' } } }` matches `'Hello World'` on both MySQL and PostgreSQL without requiring custom collations or CITEXT extensions.

#### JSON Operators Translation

| Operation                     | MySQL implementation (`db-mysql`)                                 | PostgreSQL implementation (`db-postgres`)                                                                    |
| :---------------------------- | :---------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| **Block `equals`**            | `JSON_CONTAINS(col, CAST(? AS JSON))`                             | `col @> ?::jsonb`                                                                                            |
| **Block `not_equals`**        | `COALESCE(JSON_CONTAINS(col, CAST(? AS JSON)), 0) = 0`            | `NOT (col @> ?::jsonb) OR col IS NULL`                                                                       |
| **Block `in`**                | `OR` of `JSON_CONTAINS` candidates                                | `(${col} @> ${c1}::jsonb OR ${col} @> ${c2}::jsonb)`                                                         |
| **Block `contains`**          | `JSON_TABLE` subquery checking `blockType` and `val LIKE pattern` | `EXISTS (SELECT 1 FROM jsonb_array_elements(col) AS elem WHERE elem->>'blockType' = ? AND elem->>? ILIKE ?)` |
| **Standard Array `equals`**   | `JSON_CONTAINS(JSON_EXTRACT(col, path), CAST(? AS JSON))`         | `EXISTS (SELECT 1 FROM jsonb_array_elements(col) AS elem WHERE elem->>? = ?)`                                |
| **Standard Array `in`**       | `JSON_OVERLAPS(JSON_EXTRACT(col, path), CAST(? AS JSON))`         | `EXISTS (SELECT 1 FROM jsonb_array_elements(col) AS elem WHERE elem->>? = ANY(?))`                           |
| **Standard Array `contains`** | `JSON_SEARCH(col, 'one', pattern, NULL, path) IS NOT NULL`        | `EXISTS (SELECT 1 FROM jsonb_array_elements(col) AS elem WHERE elem->>? ILIKE ?)`                            |
| **Version Filename Check**    | `JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.filename')) = ?`          | `snapshot->>'filename' = ?`                                                                                  |

### 5. Error Mapping (ADR 0008 Parity)

[ADR 0008](0008-db-error-handling.md) established that database errors must be typed at the adapter boundary, preventing raw SQL leakage and mapping unique violations to user-friendly validation issues.

The PostgreSQL adapter maps native PostgreSQL errors as follows:

- **Unique Constraint Violation (`23505`)**:
  - PostgreSQL returns error code `'23505'` (`unique_violation`) with details such as `Key (slug)=(existing-slug) already exists` and `constraint: "posts_slug_unique"`.
  - The adapter parses the conflicting key and value from the error detail or constraint name, matches it against collection/global fields using `findFieldName()`, and throws `UniqueConstraintError(field, value)`.
- **Foreign Key Violation (`23503`)**:
  - Wrapped in `DatabaseError('Database operation failed', { cause: err })`.
- **All other database errors**:
  - Wrapped in `DatabaseError('Database operation failed', { cause: err })`.
  - Raw SQL statements, parameters, and table structures are never exposed in `err.message`.

### 6. Interface Changes (`DatabaseAdapter`)

To remove MySQL assumptions from `@lontar/core` and `@lontar/cli`, the `DatabaseAdapter` interface is updated:

1. **Explicit `dialect` property**:
   ```ts
   export interface DatabaseAdapter {
     /** Human-readable adapter name, e.g. 'mysql' or 'postgres'. */
     readonly name: string
     /** Drizzle Kit dialect identifier: 'mysql' | 'postgresql' | 'sqlite'. */
     readonly dialect: 'mysql' | 'postgresql' | 'sqlite'
     /** Optional maximum VARCHAR length supported by the database engine. */
     readonly maxStringLength?: number
     // ...
   }
   ```
   - `adapter.name` remains `'mysql'` or `'postgres'`.
   - `adapter.dialect` provides the exact dialect name required by `drizzle-kit` (`--dialect postgresql` for Postgres, `--dialect mysql` for MySQL).
2. **`maxStringLength` delegated to adapter**:
   - `packages/core/src/config/define-config.ts` checks `if (config.db.maxStringLength !== undefined && field.maxLength > config.db.maxStringLength)`.
   - `mysqlAdapter` sets `maxStringLength: 16383`.
   - `postgresAdapter` leaves `maxStringLength` undefined (or set to PostgreSQL's multi-megabyte limit), removing the MySQL VARCHAR check from core.
3. **Migration hints decoupled**:
   - The CLI `migrate:create` warning regarding `_status NOT NULL` backfill is made dialect-agnostic or sourced from the adapter.

### 7. Shared Code and Architecture Boundaries

- **Rule 6 maintained**: `@lontar/core` never imports Drizzle.
- **What stays in `@lontar/core`**:
  - `DatabaseAdapter` interface and error types (`DatabaseError`, `UniqueConstraintError`).
  - `Where` filter validation, path resolution, and type checking (`validateWhere`, `validateSort`).
  - Pagination limit capping (`capLimit`) and page/offset math.
- **What is shared across adapters**:
  - Dynamic table construction patterns, error context parsing (`findFieldName`), and sanitization helpers.
  - A shared adapter conformance test suite ([#304](https://github.com/handi7/lontar-cms/issues/304)) that runs identical test scenarios against both MySQL and PostgreSQL adapters.

### 8. Migrations and Switching Adapters

- **Dialect-Specific DDL**: Drizzle Kit generates raw SQL DDL specific to the target database dialect (e.g. MySQL `DATETIME(3)` and backtick identifiers vs. PostgreSQL `timestamptz` and double quotes).
- **Project Migrations Directory**:
  - A project's `migrations/` directory contains SQL files for the configured adapter's dialect.
  - Drizzle Kit tracks migrations using a dialect-specific journal (`migrations/meta/_journal.json`).
- **Switching Adapters**:
  - SQL migrations from one dialect cannot be executed against another dialect.
  - When switching an existing project between database adapters, developers must generate a fresh baseline migration for the new dialect using `lontar migrate:create` with the new adapter configured.

---

## Public API Specification (README Updates)

The public API for the PostgreSQL adapter matches `mysqlAdapter`:

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

---

## Consequences

### Easier

- Developers can run Lontar on PostgreSQL, enabling deployment on Supabase, Neon, AWS RDS PostgreSQL, Google Cloud SQL, and self-hosted Postgres instances.
- Core and CLI are free of hardcoded MySQL assumptions, making subsequent adapters (such as SQLite) much simpler to implement.
- Full parity between MySQL and PostgreSQL queries, including nested block/array filters and case-insensitive text search.

### Harder

- CI must run integration tests and CLI tests against both MySQL and PostgreSQL containers, increasing test execution time.
- Adapter conformance suite must be maintained to prevent semantic regressions between database implementations.
