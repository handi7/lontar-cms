# 0013: String field length limits and validation alignment

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Prior to this decision, string field definitions, Zod validation schemas, and database column definitions were not properly aligned:

1. **Unbounded Zod schemas for bounded MySQL columns**:
   - `text` fields without an explicit `maxLength`, `email` fields, and `slug` fields were provisioned as `varchar(255)` columns in MySQL.
   - However, their Zod validation schemas in `packages/core/src/client/zod.ts` had no `.max()` limit.
   - Inputs longer than 255 characters would pass request validation, only to fail at the database level with a MySQL `Data too long` error, violating Rule 5 in `AGENTS.md` ("One source of validation").
2. **Invalid `VARCHAR` column generation on MySQL**:
   - In MySQL InnoDB (with `utf8mb4`), the maximum column length for a `VARCHAR` column is 16,383 characters (because 16,383 × 4 = 65,532 bytes, which fits within MySQL's maximum row size limit of 65,535 bytes).
   - If a developer specified `f.text({ maxLength: 20000 })`, table creation and migrations would fail with `Column length too big for column ... (max = 16383)`.
3. **Missing max length constraints in Admin form inputs**:
   - Admin form inputs for `email` and `slug` lacked the `maxLength` HTML attribute, allowing users to type input exceeding column capacity before submit.

## Decision

1. **Default `maxLength: 255` in ClientConfig and Zod**:
   - In `packages/core/src/config/to-client-config.ts`:
     - `text` fields serialize `maxLength: field.maxLength ?? 255`.
     - `email` and `slug` fields serialize `maxLength: 255`.
   - In `packages/core/src/client/zod.ts`:
     - `text`, `email`, and `slug` schemas apply `.max(field.maxLength ?? 255)`.
   - Inputs exceeding 255 characters are rejected at the REST API boundary with standard 400 validation issues before hitting the database.
2. **Config Validation in `defineConfig` (`@lontar/core`)**:
   - Validates that `text` fields do not declare `maxLength > 16383`. If exceeded, `defineConfig` throws a `LontarConfigError` explaining the limit and recommending `textarea` (which maps to `TEXT`).
   - Validates that `maxLength` is a positive integer, `minLength` is a non-negative integer, and `minLength <= maxLength`.
3. **Admin Form Inputs (`@lontar/admin`)**:
   - Added `maxLength={field.maxLength}` to `EmailFieldInput` and `SlugFieldInput` in `FieldRenderer.tsx`, matching `TextFieldInput` and `TextareaFieldInput`.

## Consequences

- Guarantees that any input passing Zod validation fits cleanly into the underlying database column.
- Prevents database migration failures by detecting excessively large `text.maxLength` values at config evaluation time.
- Enforces consistent client-side and server-side length limits across `text`, `email`, and `slug` fields.
