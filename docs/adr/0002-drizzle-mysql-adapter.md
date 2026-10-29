# 0002: Drizzle and MySQL behind a database adapter interface

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Lontar generates a database schema from config and runs queries against it. Two decisions follow: which data-access library to build on, and how tightly the rest of the codebase is allowed to know about it.

v0.1 targets MySQL only. Postgres and SQLite are explicit non-goals for now, but they are expected later, and the cost of retrofitting a database abstraction after the fact is high: query construction tends to leak into every operation.

Schema generation adds a second wrinkle. Lontar's schema lives in config, not in a checked-in schema file, so the usual "write a schema file, diff it" migration workflow does not apply directly.

## Decision

Use **Drizzle ORM** as the data-access layer and **MySQL** as the only implementation in v0.1, behind an adapter interface defined in `packages/core`.

`packages/core` never imports Drizzle. It defines the interface; `packages/db-mysql` implements it.

The interface is split in two, because the halves have different lifecycles:

- **Runtime** — `find`, `findByID`, `create`, `update`, `delete`. Called while serving requests, by operations and the Local API.
- **Build-time** — `toSchemaFile(config): string` and `migrate()`. Called only by the CLI, never during a request.

Migrations work by emitting a Drizzle schema file from the config and handing it to Drizzle's own tooling:

1. `lontar migrate:create` loads `lontar.config.ts` via [`jiti`](https://github.com/unjs/jiti), calls `adapter.toSchemaFile(config)`, writes `.lontar/schema.ts`, then runs `drizzle-kit generate` to produce a SQL migration in `migrations/`.
2. `lontar migrate` runs the generated SQL with the `drizzle-orm/mysql2` migrator, programmatically.

`.lontar/` is a derived artifact and is gitignored. `migrations/` is committed: it is the source of truth for schema history, and it is what reviewers read.

## Alternatives considered

- **Hand-rolled SQL DDL from field definitions.** Full control and no generated schema file, but it means writing and owning a schema differ — the part of migration tooling that is hardest to get right and most damaging when wrong. Rejected as reinventing a solved problem.
- **drizzle-kit's programmatic diff/push API against an in-memory schema.** Avoids the generated file, but relies on APIs that are not public and may change between releases. Rejected: too much of the migration story resting on internals.
- **Prisma.** Strong migration tooling, but its schema lives in a `.prisma` file and its client is generated ahead of time, which fits poorly with a schema derived from a TypeScript config at runtime.
- **Raw `mysql2` with a query builder of our own.** Rejected for the same reason as hand-rolled DDL.

## Consequences

**Easier.** Adding Postgres or SQLite later means implementing one interface, not auditing the codebase for leaked MySQL assumptions. Migration history is plain SQL in Git, reviewable in a pull request. The runtime/build-time split means a future adapter can bring its own migration tooling without inheriting MySQL's.

**Harder.** There is a generated file in the loop, so `.lontar/schema.ts` must stay consistent with the config; a stale copy produces a wrong diff. The CLI shells out to `drizzle-kit` for the generate step, which adds a process boundary and a dependency on its CLI surface.

The adapter interface also has to stay genuinely database-agnostic while having exactly one implementation, which is the condition under which abstractions quietly grow MySQL-shaped. Reviewing the interface against a second database before v0.2 is worth doing deliberately.

**To revisit.** When `richText` and later `blocks` arrive, the open question in [`../scope.md`](../scope.md) — one column per field versus storing some fields as JSON — becomes live. v0.1 maps one column per field, which is sufficient for the scalar field types in scope and does not pre-commit the answer.
