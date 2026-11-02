# 0017: Local API (getLontar) and shared transport-agnostic CRUD operations

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

In a headless CMS running inside a modern full-stack framework (such as Next.js React Server Components or standalone Node.js), fetching content directly on the server via internal HTTP requests to `/api/...` causes unnecessary network overhead, latency, baseURL configuration friction, and redundant serialization.

Issue #68 highlighted that:

1. `getLontar(config)` described in the README spec was not implemented in `@lontar/core`.
2. CRUD logic (access validation, beforeChange hooks, DB operations, populate/depth, afterChange/afterRead hooks) was tightly coupled to Hono route handlers in `server/routes/collection.ts` and `server/routes/global.ts`.
3. In the initial draft README, `auth: { collection: 'users' }` was specified, but Better Auth in M2 creates a `user` table with string UUIDs (`varchar(36)`), whereas Lontar collections and relationship fields only support positive integer IDs (`int('id').autoincrement()`), and the admin panel does not support password hashing or account lifecycle management for arbitrary collection forms.

## Decision

1. **Shared Transport-Agnostic CRUD Operations (`packages/core/src/operations/`)**:
   - Pulled all collection and global mutation and query logic into standalone, reusable operations:
     - `findOperation`: validates access (if not overridden), validates `where` filter, executes DB find, runs `afterRead` hooks, and populates relationships.
     - `findByIDOperation`: validates access, executes DB findByID, runs `afterRead` hooks, and populates relationships.
     - `createOperation`: validates access, validates fields with Zod, runs `beforeChange` hooks, writes to DB, runs `afterChange` hooks with rollback compensation, and populates relationships.
     - `updateOperation`: validates access, validates partial fields with Zod, checks existing document, runs `beforeChange` hooks, updates DB, runs `afterChange` hooks with rollback compensation, and populates relationships.
     - `deleteOperation`: validates access, deletes DB document, and triggers media cleanup when deleting an upload collection document.
     - `findGlobalOperation` and `updateGlobalOperation`: manage single-document globals with hooks and validation.
   - REST route handlers in `collection.ts` and `global.ts` now act as thin wrappers around these operations.

2. **Local API Client (`getLontar(config)` in `packages/core/src/local/`)**:
   - `getLontar(config)` initializes and returns a `LontarClient` supporting:
     - `find(collection, options?)`
     - `findByID(collection, idOrOptions, options?)`
     - `create(collection, dataOrOptions)`
     - `update(collection, idOrOptions, dataOrOptions?)`
     - `delete(collection, idOrOptions, options?)`
     - `findGlobal(slug, options?)`
     - `updateGlobal(slug, dataOrOptions?)`
   - **Access Control Decision**: In `getLontar`, `overrideAccess` defaults to `true`. On the server (RSC, background jobs, seeders), code is running in a trusted execution environment. Passing `{ overrideAccess: false, user }` allows callers to enforce user-specific permissions when desired.
   - `populateDocs` and `populateDoc` honor `overrideAccess`, ensuring related documents can be populated seamlessly in server-side queries.

3. **Clarification on Auth and Authors Collection for v0.1**:
   - Updated `README.md` to define an explicit `Authors` collection (with standard `id: int autoincrement` and relationship fields) for content authors, matching v0.1 MVP scope.
   - Auto-created user collections with string IDs and admin user management are deferred to v0.2.

## Consequences

- Server components and scripts can query and mutate Lontar data directly with zero HTTP overhead.
- REST endpoints and the Local API share the exact same underlying validation, hooks, database writes, and relationship population logic.
- Strong type safety and idiomatic error handling (`NotFoundError`, `ValidationError`, `AccessDeniedError`).
