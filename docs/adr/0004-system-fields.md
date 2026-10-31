# 0004: Every document has an integer `id` and engine-managed timestamps

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The README fixes the REST routes (`GET /api/posts/:id`) but not what an `id` is, and says nothing about fields a document has without declaring them. Both have to be settled before the first collection reaches the database, because they shape the generated table, the document type in `InferDoc`, the `DatabaseAdapter` signatures, and the admin list view.

## Decision

Every collection gets three **system fields** that are not declared in config:

- `id`: an auto-incrementing integer primary key. TypeScript type `number`.
- `createdAt` and `updatedAt`: set by the engine on create and update. TypeScript type `string`, in ISO 8601.

System fields are read-only to API clients. The Zod schema built from a collection's fields strips them from input, so a client cannot choose an `id` or backdate a document.

Their names are reserved: `defineConfig` rejects a field called `id`, `createdAt` or `updatedAt`. They are not listed in `ClientCollection.fields`, since every document has them, but `admin.useAsTitle` and `admin.defaultColumns` may name them. `useAsTitle` defaults to `id`.

Dates are ISO 8601 strings on every API surface, the Local API included, so a document has the same type whether it came over HTTP or not.

The names live in `SYSTEM_FIELDS`, exported from `@lontar/core/client` so the admin can use the same list.

## Alternatives considered

- **UUID (v7) primary keys.** Can be generated before insert and do not reveal row counts, but they cost a wider `CHAR(36)` key and longer URLs. Nothing in v0.1 needs IDs generated outside the database. Rejected; switching later changes the `id` type in every generated document type, so it is a breaking change.
- **No automatic timestamps.** Keeps tables minimal, but nearly every collection wants them, the admin list wants a default sort, and hand-declared timestamps would rely on every config author remembering hooks. Rejected.
- **Timestamps that can be turned off per collection.** Adds a config option and a branch through schema generation, operations and the admin for a case nobody has asked for. Can be added later without breaking anything.
- **`Date` objects in the Local API.** More convenient on the server, but then the same document has two types depending on how it was fetched. Rejected.

## Consequences

**Easier.** Every table has the same primary key shape, so the adapter interface takes `id: number` everywhere. The admin can always show and sort by `createdAt` without knowing the collection.

**Harder.** Integer IDs show how many rows exist and can be guessed. Access control, not ID obscurity, is what protects documents, so this is acceptable, but it rules out treating IDs as secrets.

**To revisit.** Globals (single documents) will need their own answer: they have timestamps but no meaningful `id`. Decide when globals are implemented.
