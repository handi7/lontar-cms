# 0022: Declarative data-driven conditional fields

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

In complex content models, fields often need to be shown or hidden based on the values of other fields (for example, showing a `videoUrl` text field only when a `format` select field equals `'video'`, or showing an `expiresAt` date field only when `hasExpiry` checkbox is checked).

In other CMSs (such as Payload), conditions are written as JavaScript functions:

```ts
// Payload pattern (incompatible with Lontar architecture)
admin: {
  condition: (data, siblingData) => data.format === 'video'
}
```

In Lontar, this approach is prohibited by two core architecture rules:

1. **Rule 1 & 2 (`ClientConfig` is plain JSON)**: `defineConfig()` is server-only. The admin SPA never imports server config files; it receives serialized configuration via `GET /api/_lontar/config`. Functions cannot be serialized to JSON (ADR 0003).
2. **Rule 5 (One source of validation)**: Field definitions compile to Zod schemas shared across server and admin. If a field is conditionally hidden in the admin, the server's Zod validation must know not to enforce `required: true` when the field is omitted. Writing separate validation logic on the server and admin violates single-source validation.

Therefore, conditional logic must be expressed as **declarative data** rather than code.

## Decision

### 1. Condition Syntax: Reuse Query `where` Operators

Conditional fields are configured via `admin.condition`, accepting a declarative condition structure that matches Lontar's existing `Where` filter syntax:

```ts
export type FieldCondition = Where
```

Example field definition:

```ts
fields: {
  format: f.select({
    options: ['standard', 'video', 'quote'],
    defaultValue: 'standard',
  }),
  videoUrl: f.text({
    required: true,
    admin: {
      condition: {
        format: { equals: 'video' },
      },
    },
  }),
}
```

- **Supported operators**:
  - `equals`, `not_equals`
  - `in`
  - `contains`
  - `greater_than`, `less_than`, `greater_than_equal`, `less_than_equal`
  - `exists` (`true` checks that the target field is not `null`, `undefined`, or `''`; `false` checks that it is empty/null)
  - Compound boolean logic via `and: [...]` and `or: [...]`

Reusing the `Where` syntax means developers only learn one query language in Lontar for querying, filtering, and conditional logic.

### 2. Condition Scoping: Sibling Fields and Document Root (`$root`)

Conditions operate across different structural levels:

1. **Sibling Fields (Default)**:
   - Any unqualified field path (e.g. `format`, `actionType`) resolves against the current row or sibling scope (`siblingData`).
   - At the root of a collection or global, sibling data is identical to document data.
   - Inside an `array` row, a `blocks` item, or a `group`, unqualified names look up sibling properties on that specific row/item. This covers the vast majority of conditional field use cases.

2. **Document Root (`$root`)**:
   - Inside an `array` or `blocks` item, fields may need to condition on top-level document values (for example, hiding an item-level field if the entire page has `$root.status: { equals: 'archived' }`).
   - Prefixing the path with `$root.` (e.g. `'$root.status'` or `'$root.seo.noIndex'`) resolves against the root document data.

### 3. Server and Client Validation Synchronization

A conditionally hidden field must not trigger validation failures if omitted:

1. **Schema Generation (`packages/core/src/client/zod.ts`)**:
   - If a field is marked `required: true` and defines an `admin.condition`:
     - The field's property schema is made optional (`.optional().nullable()`).
     - A container-level `.superRefine()` checks `matchesCondition(condition, data, siblingData)`.
     - If the condition evaluates to `true` and the field value is missing, empty, or `null`, a Zod issue is registered at that field's path (`This field is required`).
     - If the condition evaluates to `false`, the field is valid regardless of whether it is absent or present.
2. **Deterministic Validation**: Because Zod runs identically on the server route handlers and in the admin SPA form runner (Rule 5), form validation and API mutation validation are always in perfect agreement.
3. **Database Column Nullability**: Any database column for a field with `admin.condition` (or nested inside a conditional group) is created nullable regardless of `required: true`. In conditional fields, `required: true` means "required while visible", enforced by application validation rather than a database-level `NOT NULL` column. Because the mutation pipeline clears inactive values to `null` before persistence (§4), a `NOT NULL` column would trigger a database constraint failure whenever the field is hidden.

### 4. Storage of Inactive Values: Clear on Mutation

When an editor toggles a condition (e.g., switches `format` from `'video'` to `'standard'`), any previously entered value in `videoUrl` becomes inactive:

- **Mutation Pipeline (`packages/core/src/operations/mutation.ts`)**:
  - During `create` and `update` operations, the mutation engine runs `matchesCondition` on each field before database persistence.
  - If a field's condition evaluates to `false`, its value is automatically cleared to `null` (or stripped if inside a JSON array/block).
- **Admin UI**:
  - The admin form runner clears inactive field values or unregisters them on submission.
- **Rationale**: Prevents ghost/zombie data from lingering in the database. API consumers reading documents will never see a document with `format: 'standard'` containing leftover `videoUrl` values.

### 5. Shared Condition Evaluator in `@lontar/core/client`

A single, pure, isomorphic evaluation function is implemented in `@lontar/core/client`:

```ts
export function matchesCondition(
  condition: FieldCondition,
  data: Record<string, unknown>,
  siblingData?: Record<string, unknown>,
): boolean
```

- **Location**: `packages/core/src/client/condition.ts`, exported via `@lontar/core/client`.
- **Runtime**: Pure TypeScript with zero Node.js or browser-specific dependencies. Usable inside server API handlers, Zod schema transforms, and React admin hooks.
- **Admin integration**: `FieldRenderer.tsx` and block renderers use `useWatch` from React Hook Form to observe form values and call `matchesCondition` to show or hide form controls dynamically.

### 6. ClientConfig Serialization

`admin.condition` is serializable plain JSON. It is included directly on `ClientField`:

```ts
export interface ClientFieldBase {
  name: string
  label: string
  required: boolean
  condition?: FieldCondition
}
```

No special serialization transforms or lossy function conversions are required.

## Alternatives Considered

- **JavaScript functions in config**:
  Rejected because functions cannot be serialized into JSON (`ClientConfig`), violating Architecture Rules 1, 2, and 3.
- **Separate admin-only condition logic**:
  Rejected because a field hidden in the admin would fail server-side `required: true` validation on save unless the server duplicated the conditional logic, violating Architecture Rule 5.
- **Preserving inactive values in the database**:
  Rejected because leaving hidden values in the database produces corrupted, misleading API responses and creates orphaned relationship references.

## Consequences

### Easier

- Clean, declarative API for toggling fields based on parent or sibling values.
- Perfect parity between server validation and admin SPA form behavior.
- Automatic clearing of inactive values prevents database pollution.
- Single unified query syntax across `where` queries and conditional logic.

### Harder

- Complex condition expressions with multi-level `$root` paths must be evaluated recursively against both root and sibling context objects.
- Container-level Zod validation schemas require `.superRefine()` blocks for conditional `required` fields.
