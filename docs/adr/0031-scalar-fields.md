# 0031: Scalar fields — json, radio, code, point, and hasMany scalars

- **Status:** Accepted
- **Date:** 2026-11-24
- **Accepted:** 2026-11-24 ([#501](https://github.com/handi7/lontar-cms/issues/501))

## Context

Milestone 13 focuses on content model completeness ([#500](https://github.com/handi7/lontar-cms/issues/500)). Prior milestones delivered fundamental scalar types (`text`, `number`, `textarea`, `email`, `slug`, `checkbox`, `select`, `date`), relationships and uploads (`relationship`, `upload`), rich text (`richText`), and structured nesting (`group`, `array`, `blocks`).

However, several common scalar data shapes still lack native field types, forcing developers to use workarounds (such as storing code or JSON inside plain `textarea` fields without syntax aids or size boundaries, or building full `array` fields with single-subfield rows just to hold tags or keywords).

This ADR settles the storage, validation, querying, and admin presentation contracts for five scalar field types before implementation:

1. `code`: multiline code snippets with syntax highlighting and language configuration.
2. `json`: arbitrary structured JSON data with size boundaries.
3. `radio`: single-choice selection presented as radio buttons with layout control.
4. `point`: geographic coordinate pairs (`[longitude, latitude]`).
5. `hasMany` on `text` and `number`: ordered lists of primitive values.

---

## Decision

### 1. The `code` Field

A multiline string field specialized for source code, configuration scripts, CSS, SQL, or HTML.

```ts
f.code({
  language?: string // e.g. 'typescript', 'javascript', 'html', 'css', 'json', 'python', 'sql'
  minLength?: number
  maxLength?: number
  defaultValue?: string
  required?: boolean
})
```

- **Database storage**: Stored as `TEXT` in MySQL and `text` in PostgreSQL, identical to `textarea`.
- **Length limits**:
  - Validates that `maxLength <= 65535` if specified, matching MySQL InnoDB `TEXT` limits (ADR 0013).
  - Defaults to unconstrained within the database column limit if omitted.
- **Language option**: `language?: string` provides an editor mode hint (such as `'typescript'`, `'html'`, `'json'`). If omitted, the editor defaults to plain text with monospace formatting and tab indentation.
- **Relationship to `textarea`**: `textarea` is intended for unstructured human-language text with word-wrapping. `code` uses monospace typography, preserves indentation, supports tab indentation handling, and shares a lightweight code editor with `json` in the admin SPA.
- **ClientConfig**: Serializes `type: 'code'`, `language?: string`, `minLength?: number`, `maxLength?: number`.
- **TypeScript type**: Inferred as `string` (or `string | null` when `required: true` is not set).

### 2. The `json` Field

Stores free-form structured JSON data without requiring a rigid CMS schema.

```ts
f.json({
  maxBytes?: number // default 65536 (64 KB), max 1048576 (1 MB)
  defaultValue?: JsonValue
  required?: boolean
})
```

- **Database storage**: Stored as native `json` in MySQL and `jsonb` in PostgreSQL.
- **Distinction from `array` and `blocks`**:
  - `array` and `blocks` are structured collections with declared CMS subfields and automatic row identity (`id: string`) for list diffing and nested relationships (ADR 0021).
  - `json` is an opaque, free-form value (`Record<string, unknown> | unknown[] | string | number | boolean | null`). No `id` properties are injected or managed by Lontar.
- **DoS protection & payload limits**:
  - Free-form JSON columns present memory exhaustion and DoS vectors if arbitrarily large payloads are accepted.
  - `maxBytes?: number` sets the maximum serialized byte length. Default is 64 KB (`65536` bytes); maximum allowable configuration is 1 MB (`1048576` bytes).
  - Zod validation rejects payloads whose serialized UTF-8 size (`Buffer.byteLength(JSON.stringify(val))`) exceeds `maxBytes`.
- **Querying and `where` path resolution**:
  - **`where` does NOT reach into nested paths of a `json` field.** Dot-paths like `where[metadata.nestedKey][equals]=123` are rejected with `400 Validation failed`.
  - **Rationale**: In Lontar, `validateWhere` strictly verifies paths and types against `collection.fields` (ADR 0012, ADR 0021 §4). Because `json` has no declared schema, allowing arbitrary subpaths would bypass schema validation, prevent operator type checking, and force unindexed full-table JSON path scans across the database.
  - **Allowed operators**: Only top-level existence/nullability operators (`null`, `not_null`, `equals: null`, `not_equals: null`).
  - Developers who require queryable, indexed, or schema-validated nested properties must use `group` (1:1) or `array`/`blocks` (1:N).
- **ClientConfig**: Serializes `type: 'json'`, `maxBytes?: number`.
- **TypeScript type**: Inferred as `JsonValue` (or `JsonValue | null`).

### 3. The `radio` Field

Single-select option picker displayed as an explicit group of radio buttons.

```ts
f.radio({
  options: readonly SelectOption[]
  layout?: 'horizontal' | 'vertical' // default 'vertical'
  defaultValue?: string
  required?: boolean
})
```

- **Database storage**: Stored as `varchar(255)` on MySQL and `varchar(255)` / `text` on PostgreSQL, matching `select`.
- **Options definition**: Shares the existing `SelectOption` format (`string` or `{ label: string, value: string }`).
- **Layout**: `layout?: 'horizontal' | 'vertical'` defaults to `'vertical'`. Serialized into `ClientField` to control visual alignment in the admin UI.
- **Registry & admin UI**:
  - Core treats `radio` as its own field type (`type: 'radio'`).
  - The admin SPA registers a dedicated `RadioFieldInput` component in the field registry, built on shadcn/ui RadioGroup.
- **Validation**: Zod validates that the value matches one of the declared option values.
- **TypeScript type**: Union of option string literals (or union `| null`).

### 4. The `point` Field

Represents a geographic coordinate pair: `[longitude, latitude]`.

```ts
f.point({
  defaultValue?: [number, number]
  required?: boolean
})
```

- **Format**: A 2-element tuple of numbers `[longitude, latitude]`, conforming to the GeoJSON coordinate order (`[lng, lat]`).
- **Database storage**:
  - **Top-level fields**: Flattened into two separate numeric columns on the collection table: `${fieldName}__lng` and `${fieldName}__lat` (`double` in MySQL, `double precision` in PostgreSQL).
  - **Nested inside `array` or `blocks`**: Stored as a 2-element numeric array `[lng, lat]` within that item's JSON object.
  - **Why flattened columns for top-level?**
    1. Consistent with top-level `group` fields (ADR 0021 §1).
    2. Uses standard numeric types supported natively on MySQL, PostgreSQL, and SQLite without requiring PostGIS or MySQL GIS extensions.
    3. Enables standard B-tree indexing and range queries (`<`, `>`, `<=`, `>=`).
- **Validation**:
  - Must be a 2-element array of finite numbers.
  - Longitude range: `-180 <= lng <= 180`.
  - Latitude range: `-90 <= lat <= 90`.
- **Querying (`where` and `sort`)**:
  - Coordinate sub-properties are queried using dot notation:
    - `${fieldName}.lng` (alias `${fieldName}.longitude`)
    - `${fieldName}.lat` (alias `${fieldName}.latitude`)
  - Supported `where` operators: `equals`, `not_equals`, `greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`.
  - Both `${fieldName}.lng` and `${fieldName}.lat` can be used in `sort`.
  - **Out of scope**: Specialized geospatial calculations (such as `near`, `within`, bounding box, or Haversine distance functions) are explicitly deferred.
- **ClientConfig**: Serializes `type: 'point'`.
- **TypeScript type**: Inferred as `[number, number]` (or `[number, number] | null`).

### 5. `hasMany` on `text` and `number`

Allows `text` and `number` fields to hold an ordered list of scalar values without creating a full `array` field.

```ts
// Array of strings (e.g. tags, keywords)
f.text({
  hasMany: true,
  minRows?: number,
  maxRows?: number,
  minLength?: number,
  maxLength?: number,
  defaultValue?: string[],
  required?: boolean,
})

// Array of numbers (e.g. pin codes, dimension steps)
f.number({
  hasMany: true,
  minRows?: number,
  maxRows?: number,
  min?: number,
  max?: number,
  integer?: boolean,
  defaultValue?: number[],
  required?: boolean,
})
```

- **Database storage**:
  - Stored as a single `json` column on MySQL and `jsonb` on PostgreSQL.
  - **Why not junction tables?** Unlike `relationship({ hasMany: true })`, which references other document rows and requires foreign key cascades, scalar lists hold primitive values. A junction table for every primitive array would cause table explosion, migration churn, and relational join overhead for simple lists of strings or numbers.
- **Ordering**: The user-defined element order is preserved directly within the JSON array.
- **Limits & validation**:
  - `minRows?: number` (default `0`) and `maxRows?: number` (default `100`, ceiling `500`), matching `array` field bounds (ADR 0021 §5).
  - Every element must satisfy the scalar constraints:
    - `text`: `minLength`, `maxLength` (default 255 per ADR 0013).
    - `number`: `min`, `max`, `integer`.
- **Querying (`where` and `sort`)**:
  - `contains`: Checks if the scalar array contains the target value.
    - MySQL: `JSON_CONTAINS(col, JSON_QUOTE(?))` for strings, `JSON_CONTAINS(col, CAST(? AS JSON))` for numbers.
    - PostgreSQL: `col @> ?::jsonb` (with payload serialized as `JSON.stringify([value])`).
  - `in`: Checks if the scalar array contains any of the provided values (disjunction of `contains`).
  - `equals`: Exact JSON array equality.
  - `sort`: **Disallowed** on `hasMany` scalar paths, matching ADR 0021 §4 (sorting by an array of values is ill-defined in SQL).
- **ClientConfig**: Serializes `hasMany: true` on `ClientTextField` and `ClientNumberField`.
- **TypeScript type**: Inferred as `string[]` (or `string[] | null`) for text, `number[]` (or `number[] | null`) for number.

---

### 6. Cross-cutting System Behaviors

#### Versions, Drafts, and Snapshots

All five scalar fields store plain JSON-serializable values (`string`, `[number, number]`, `JsonValue`, `string[]`, `number[]`).

- Snapshots in `_versions.snapshot` capture them directly.
- Version compare and restore operate without special transforms.
- Draft saves store draft states without leaking to published queries (ADR 0023).

#### Content Localization (`localized: true`)

When localization is configured (ADR 0028):

- Per-locale columns are generated:
  - `code`: `${fieldName}_${locale}` (`TEXT`)
  - `radio`: `${fieldName}_${locale}` (`varchar(255)`)
  - `json`: `${fieldName}_${locale}` (`json` / `jsonb`)
  - `hasMany` text/number: `${fieldName}_${locale}` (`json` / `jsonb`)
  - `point`: Flattened columns per locale: `${fieldName}__lng_${locale}` and `${fieldName}__lat_${locale}`.
- Localized fallback, `locale=all` dictionary reads, and draft publishing function consistently with ADR 0028.

#### Access Control and Conditions

- **Field-level access**: `access: { read, create, update }` functions apply identically across all five fields (ADR 0027). Denied read fields are stripped; denied write fields are ignored during mutation.
- **Conditional fields**: `admin.condition` expressions evaluate against these fields cleanly (ADR 0022). For example, showing a configuration block only when `f.radio` equals `'custom'`.

#### ClientConfig Version

Adding `code`, `json`, `radio`, `point`, and `hasMany` scalars is an additive schema evolution. To ensure that cached or older client bundles detect the expanded field definitions cleanly, `CLIENT_CONFIG_VERSION` will be bumped from `3` to `4` when these fields land.

#### Typegen (`lontar generate:types`)

`packages/cli` generates TypeScript definitions matching the field types:

- `code`: `string`
- `json`: `JsonValue`
- `radio`: `'optionA' | 'optionB'`
- `point`: `[number, number]`
- `text({ hasMany: true })`: `string[]`
- `number({ hasMany: true })`: `number[]`

---

### 7. Engine Differences and Conformance Testing

MySQL and PostgreSQL handle JSON data types with slight dialect variations:

1. **JSON String Quotes**: MySQL `JSON_CONTAINS` requires strings to be properly JSON-quoted (via `JSON_QUOTE(?)`), whereas PostgreSQL `@>` expects a valid JSONB fragment (e.g. `["target"]::jsonb`).
2. **Numeric Comparisons**: Float comparisons for `point` coordinates must account for standard IEEE 754 precision in database queries.

The shared adapter conformance test suite (`packages/db-mysql` and `packages/db-postgres`) will add conformance cases covering:

- Storing and retrieving values for all five field types on both adapters.
- Querying `point` with range filters (`greater_than`, `less_than`) on both `.lng` and `.lat`.
- Querying `hasMany` text and number with `contains` and `in`.
- Top-level `null` and `not_null` filtering on `json` fields.
- Rejection of nested path queries into `json` fields.

---

### 8. Migration Paths

#### Changing from Single Scalar to `hasMany`

If an existing collection field changes from `f.text()` to `f.text({ hasMany: true })`:

- The column type migrates from `varchar(255)` / `TEXT` to `json` (MySQL) or `jsonb` (PostgreSQL).
- **Data preservation**: Non-null existing string values `'hello'` are converted to `['hello']`. Null values remain `null`.
- The CLI migration generator (#515) must emit the appropriate SQL update (`JSON_ARRAY(col)` on MySQL, `jsonb_build_array(col)` on PostgreSQL) to preserve existing content during migrations.

---

## Consequences

### Positive

- Completes essential content modeling primitives requested for production CMS projects.
- Eliminates manual workarounds (e.g. unformatted `textarea` for code/JSON, or heavy `array` structures for simple tag lists).
- Protects database performance and query safety by disallowing uncontrolled dot-path filtering into untyped `json`.
- Standardizes coordinate handling with native numeric columns and portable GeoJSON order (`[lng, lat]`).

### Negative / Trade-offs

- Free-form `json` fields cannot be queried by nested properties. Users needing nested query capabilities must choose `group`, `array`, or `blocks`.
- `hasMany` scalars cannot be sorted via `sort` parameters (consistent with `array` fields).
- Geographic calculations (radius, distance) are not natively evaluated by the query engine and must be performed application-side if required.

---

## Out of Scope

- Geospatial indexation (`SPATIAL INDEX`, PostGIS geometry types) and geo queries (`near`, `within`).
- Schema validation inside `json` fields (e.g. JSON Schema or Ajv validation within the CMS).
- Junction table storage for scalar `hasMany` fields.

---

## Implementation Plan

Tracked in [#500](https://github.com/handi7/lontar-cms/issues/500):

1. **#501**: This ADR and README API documentation.
2. **#504**: `code` field implementation in core, adapters, and shared admin code editor.
3. **#505**: `json` field implementation in core, adapters, and admin (reusing the code editor).
4. **#506**: `radio` field implementation in core, adapters, and admin `RadioFieldInput`.
5. **#507**: `point` field implementation in core, flattened adapter columns, and admin coordinates input.
6. **#508**: `hasMany` support for `text` and `number` fields in core, adapters, and admin tag/item input.
7. **#515**: CLI `generate:types` and single-to-many migration generator for M13 fields.
