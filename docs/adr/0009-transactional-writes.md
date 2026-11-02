# 0009: Transactional writes, rollback semantics, and junction integrity

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

In `@lontar/db-mysql`, write operations (`create`, `update`, `delete`, `updateGlobal`) executed multiple independent SQL statements without a transaction:

1. `create` inserted the main row first, followed by junction table rows for `hasMany` relationships.
2. `update` modified the main row first, deleted existing junction table rows, and inserted new junction table rows.
3. `delete` deleted junction table rows before deleting the main row.

When any intermediate statement failed (for example, if a relationship target ID was out of range for MySQL's 32-bit `INT`, or violated a unique constraint), previous statements remained committed while an error was returned to the client. This left partial database state:

- A document row existed with missing relations on failed create.
- On failed update, the main row was updated and previous relationships were wiped without inserting new ones.
- On failed delete, junction rows were deleted even if deleting the main row failed.

Furthermore:

- User-defined lifecycle hooks (`beforeChange` -> write -> `afterChange`) were not executed within a database transaction. If an `afterChange` hook threw an exception (e.g., failed notification or integration), the database change remained committed despite the API request failing with a 500 error.
- Relationship and upload IDs had no upper bound in Zod schemas, permitting IDs exceeding MySQL's signed 32-bit integer maximum (`2147483647`) to pass validation and crash queries with database driver errors.
- Junction tables lacked indexes on `parent_id` and `target_id`, and lacked a composite unique constraint on `(parent_id, target_id)`.

## Decision

1. **Transactional Adapter Writes**:
   - Every multi-statement mutation (`create`, `update`, `delete`, `updateGlobal`) in `@lontar/db-mysql` executes within `executor.transaction(async (tx) => { ... })`.
   - If any statement inside the write fails, the transaction (or nested savepoint) is automatically rolled back by the database driver, ensuring zero partial state is persisted.

2. **Core Transaction Boundary**:
   - Added optional `transaction?<T>(cb: (txDb: DatabaseAdapter) => Promise<T>): Promise<T>` to `DatabaseAdapter` in `@lontar/core`.
   - In `executeCreate`, `executeUpdate`, and `executeGlobalUpdate`:
     - If `db.transaction` is supported by the adapter, the entire lifecycle (`runBeforeChangeHooks` -> DB write -> `runAfterChangeHooks`) runs inside a single transaction.
     - If `afterChange` or any hook throws an exception, the entire database transaction is rolled back.
     - Nested transactions in Drizzle MySQL are automatically handled via savepoints (`SAVEPOINT` / `ROLLBACK TO SAVEPOINT`), allowing atomic adapter operations within the outer core transaction.

3. **Relationship and Upload ID Validation Limits**:
   - Updated relationship and upload field Zod schemas in `packages/core/src/client/zod.ts` to bound IDs to signed 32-bit integer limits: `.max(2147483647)`.
   - Requests with IDs exceeding this limit fail fast at client and request validation before querying the database.

4. **Junction Table Constraints and Indexes**:
   - Updated `createJunctionTable` in `@lontar/db-mysql/src/schema/table.ts` and `renderJunctionTable` in `generator.ts` to include:
     - Index on `parentId` (`${table}_parent_idx`)
     - Index on `targetId` (`${table}_target_idx`)
     - Composite unique constraint on `(parentId, targetId)` (`${table}_parent_target_unique`)

## Consequences

- Prevents partial, corrupted, or orphan data across collections, globals, and junction tables on write failures.
- Ensures atomic rollback across the complete request mutation lifecycle when hooks or subsequent operations fail.
- Protects database queries from out-of-range integer driver crashes via schema validation bounds.
- Improves junction table query performance and enforces relational uniqueness at the database level.
