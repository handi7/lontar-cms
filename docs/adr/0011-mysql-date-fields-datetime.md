# 0011: MySQL date fields use DATETIME(3) instead of TIMESTAMP

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

In MySQL, `TIMESTAMP` columns store values as 32-bit integers representing seconds since the Unix epoch (`1970-01-01 00:00:01` to `2038-01-19 03:14:07` UTC). Any date outside that range causes MySQL to reject the insert/update with an `Incorrect datetime value` error (the "Year 2038 problem").

CMS content frequently requires dates outside the 1970–2038 window:

- Birth dates and historical archives (e.g., 1900, 1950)
- Long-term future scheduling, domain/contract expirations, and projections (e.g., 2040, 2100)

Previously:

- `packages/db-mysql/src/schema/table.ts` mapped user `date` fields to `timestamp(name)`.
- `packages/db-mysql/src/schema/generator.ts` generated `timestamp('${name}')` in schema files.
- While `@lontar/core` validation accepted dates before 1970 and after 2038, the MySQL driver rejected them at execution time.

## Decision

1. **Use `datetime(name, { mode: 'date', fsp: 3 })` for user `date` fields**:
   - In `packages/db-mysql/src/schema/table.ts`:
     `dateToColumn` maps `DateField` definitions to `datetime(name, { mode: 'date', fsp: 3 })`.
   - In `packages/db-mysql/src/schema/generator.ts`:
     `renderDateField` emits `datetime('${name}', { mode: 'date', fsp: 3 })` and imports `datetime` from `drizzle-orm/mysql-core`.
   - Fractional seconds precision (`fsp: 3`) preserves millisecond timestamps.

2. **Keep system audit timestamps as `TIMESTAMP`**:
   - System audit columns (`createdAt`, `updatedAt`) retain `timestamp().defaultNow().notNull()` and `timestamp().defaultNow().onUpdateNow().notNull()`, maintaining consistency with Better Auth tables and standard MySQL audit timestamp behavior.

3. **UTC Connection & Filter Casting**:
   - As established in ADR 0010, the MySQL connection pool enforces `timezone: 'Z'`, ensuring `DATETIME` strings and values sent to and read from the database are consistently treated as UTC instants.
   - In `packages/db-mysql/src/adapter.ts`, `castConfigField` normalizes date filter values via `normalizeDateString` before parsing to ensure UTC alignment in comparison queries (`less_than`, `greater_than`, etc.).

## Migration Note

For existing databases with user `date` fields defined as `TIMESTAMP`, update the column types using:

```sql
ALTER TABLE `<table_name>` MODIFY `<column_name>` DATETIME(3) [NOT NULL] [DEFAULT <default_value>];
```

Or generate and apply a Drizzle migration using `lontar migrate:create && lontar migrate`.

## Consequences

- Full support for dates from `1000-01-01` to `9999-12-31` UTC.
- Eliminates the Year 2038 limitation for all CMS user date fields.
- Preserves millisecond precision across database writes and reads.
- Backward compatibility: existing schema generation tests and dynamic table mapping are updated to expect `datetime(3)`.
