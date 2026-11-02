# 0008: Database error mapping, unique constraints, and SQL leak prevention

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

When write or read operations failed, the API had multiple security, correctness, and user experience issues:

1. **SQL query and parameter leakage**: When Drizzle queries failed, the thrown error contained the raw SQL statement and its bound parameters (`Failed query: insert into ...\nparams: ...`). Route handlers previously returned `err.message` directly in 400 responses, exposing internal schema structures, table names, and user-submitted data.
2. **Unique constraint violations as opaque strings**: Database unique violations (`ER_DUP_ENTRY`) surfaced as raw SQL errors rather than field-level validation errors. The admin UI was unable to highlight the invalid field and displayed raw SQL error alerts to users.
3. **Improper status codes for server faults**: Errors thrown from user hooks and unexpected database failures were returned as `400 Bad Request` with their raw messages, preventing clients from distinguishing between client validation errors (4xx) and server faults (5xx).
4. **Non-JSON error responses on read routes**: Unhandled exceptions on read routes fell through to Hono's default handler and returned plain-text `Internal Server Error` rather than consistent JSON.

## Decision

1. **Typed database errors at adapter boundary**:
   - Defined `DatabaseError` and `UniqueConstraintError` in `@lontar/core`.
   - `UniqueConstraintError` captures the affected `field?: string` and conflicting `value?: unknown`.
   - The database adapter (`@lontar/db-mysql`) maps known database errors:
     - MySQL `ER_DUP_ENTRY` (errno 1062) parses the conflicting value and index name, matches the index against the collection/global fields, and throws `UniqueConstraintError`.
     - All other database errors are wrapped in `DatabaseError('Database operation failed', { cause: err })`. This ensures raw SQL statements and bound parameters never appear in `err.message`.

2. **Core route error mapping**:
   - `executeCreate`, `executeUpdate`, and `executeGlobalUpdate` catch `UniqueConstraintError` and return `400 Bad Request` with a Zod-compatible issues array:
     ```json
     {
       "error": "Validation failed",
       "issues": [
         {
           "code": "custom",
           "path": ["slug"],
           "message": "Value \"taken\" is already taken"
         }
       ]
     }
     ```
   - Unknown errors, hook exceptions, and unexpected database errors are re-thrown rather than returned as 400s.

3. **Global Hono error handler**:
   - Registered `app.onError` and `router.onError` handlers in `createLontar`.
   - Logs the unhandled exception via `console.error` and responds with `500 { error: 'Internal Server Error' }` as JSON across all routes.

4. **Admin UI integration**:
   - Admin client throws `ApiClientError` holding HTTP status and parsed validation `issues`.
   - `CollectionFormView` and `GlobalFormView` read `err.issues` and map them into React Hook Form via `setError`, displaying inline validation messages directly below the corresponding inputs.

## Consequences

- Prevents sensitive schema information, column definitions, and parameter values from leaking to clients.
- Provides clear inline field error feedback in the admin UI for unique constraints (e.g. duplicate slugs, emails).
- Standardizes all unexpected failures as 500 JSON responses.
- Keeps core independent of Drizzle or MySQL-specific error structures.
