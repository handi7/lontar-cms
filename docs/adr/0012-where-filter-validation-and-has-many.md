# 0012: Query filter validation and hasMany relationship filtering

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Prior to this decision, query `where` filters were parsed from search parameters or JSON strings without validation against the target collection's schema:

1. **Silent dropping of unresolvable conditions**:
   Any filter referencing a non-existent field (e.g. typos like `where[titel][equals]=foo`) or an invalid operator (e.g. `where[title][eqauls]=bar`) was silently dropped by the database adapter, causing the REST API to return completely unfiltered results. A frontend expecting filtered content (such as published-only documents) would inadvertently receive all documents.
2. **Unsupported `hasMany` relationship filtering**:
   Because `hasMany` relationships are backed by a separate junction table rather than a column on the collection table, queries filtering by `hasMany` relationships (e.g. `where[categories][equals]=1`) were ignored by the adapter, preventing essential queries such as finding posts by category or tag.
3. **Unsafe table property access**:
   The adapter accessed `table[fieldName]` without checking property ownership, causing lookups like `where[constructor][equals]=1` to resolve to JavaScript's `Object.prototype.constructor`.

## Decision

1. **Validation in Core (`@lontar/core`)**:
   - Added `validateWhere(where, collection)` in `packages/core/src/query/validator.ts`:
     - Allows declared `collection.fields`, system fields (`id`, `createdAt`, `updatedAt`), and upload system fields (`filename`, `url`, `mimeType`, `filesize`, `width`, `height`, `sizes`) when `collection.upload: true`.
     - Validates operators against `KNOWN_OPERATORS` (`equals`, `not_equals`, `contains`, `in`, `greater_than`, `less_than`, `greater_than_equal`, `less_than_equal`), accepting primitive equality shorthand.
     - Recursively traverses `and` and `or` logical blocks.
   - In `packages/core/src/server/routes/collection.ts`, `handleFind` runs `validateWhere` on incoming `where` parameters before invoking `db.find`, returning `400 { error: 'Validation failed', issues }` if unknown fields or invalid operators are detected.

2. **`hasMany` Relationship Subqueries (`@lontar/db-mysql`)**:
   - In `packages/db-mysql/src/adapter.ts`, `parseFieldConditions` detects `hasMany` relationship fields and translates them into parameterized SQL subqueries against the junction table:
     - `equals`: `table.id IN (SELECT parent_id FROM junctionTable WHERE target_id = ?)`
     - `in`: `table.id IN (SELECT parent_id FROM junctionTable WHERE target_id IN (?))`
     - `not_equals`: `table.id NOT IN (SELECT parent_id FROM junctionTable WHERE target_id = ?)`
   - Guarded column lookups in `parseFieldConditions` and `resolveOrderBy` with `Object.hasOwn(table, fieldName)`.

## Consequences

- Prevents accidental data leaks by rejecting invalid query filters with a structured 400 response.
- Enables category and tag filtering on CMS collections with `hasMany` relationships.
- Guarantees safe column property lookup on runtime Drizzle table models.
