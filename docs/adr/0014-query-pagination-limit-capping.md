# 0014: Query pagination limit capping and configuration

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Prior to this decision, the REST API accepted any numeric `?limit=` query parameter without enforcing an upper bound:

1. **Denial of Service & Out-of-Memory Risk**:
   - An API consumer could request `GET /api/posts?limit=1000000000`.
   - The database adapter would execute a `SELECT ... LIMIT 1000000000`, causing the database to perform full table scans and loading excessive rows into Node.js process memory.
2. **Missing Configuration for Pagination**:
   - Neither global `defineConfig` nor individual `collection({ ... })` definitions supported configuring default limits or maximum limit ceilings.
3. **Internal Unbounded Queries vs Public REST API**:
   - While the public REST API must always bound pagination parameters, internal callers (such as relationship population or background tasks) sometimes require retrieving all matching documents in a single query without artificial truncation.

## Decision

1. **Configurable Default and Maximum Limits**:
   - Standard defaults:
     - `DEFAULT_LIMIT = 10`
     - `MAX_LIMIT = 100`
   - Added `PaginationConfig`:
     ```ts
     export interface PaginationConfig {
       defaultLimit?: number
       maxLimit?: number
     }
     ```
   - Configurable at both the global config level (`defineConfig({ pagination: ... })`) and per-collection level (`collection({ pagination: ... })`).
   - Collection-level configuration takes precedence over global configuration.
2. **Config Validation**:
   - `defineConfig` validates that:
     - `defaultLimit` and `maxLimit` are positive integers (`> 0`).
     - `defaultLimit <= maxLimit`.
   - Throws clear `LontarConfigError` issues if invalid.
3. **ClientConfig Serialization**:
   - `toClientCollection` serializes `pagination: { defaultLimit, maxLimit }` to `ClientCollection` so admin UI tables and pagination controls know collection limits.
4. **REST API Parameter Clamping**:
   - In `packages/core/src/server/routes/collection.ts` (`handleFind`):
     - Parses `limit` from query string. If omitted, non-positive (`<= 0`), or `NaN`, falls back to `effectiveDefaultLimit`.
     - Clamps parsed `limit` to `effectiveMaxLimit` (`Math.min(limit, effectiveMaxLimit)`).
     - Clamps `page` to `>= 1`.
5. **Database Adapter Semantics**:
   - In `@lontar/db-mysql` (`findDocs`):
     - Bounded queries (`limit > 0`) clamp `limit` to `collection.pagination?.maxLimit` as defense-in-depth.
     - `limit: 0` explicitly represents an unlimited query (no `LIMIT` or `OFFSET` applied in SQL, returning `limit: 0, totalPages: 1`) for internal engine use (e.g. population, migration scripts).

## Consequences

- Prevents resource exhaustion and denial of service via uncontrolled `?limit=` query parameters.
- Allows collections to customize default and maximum page sizes cleanly in config.
- Preserves explicit `limit: 0` capability for internal engine operations that legitimately need all matching documents.
