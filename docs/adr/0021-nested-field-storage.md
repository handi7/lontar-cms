# 0021: Storage, querying, and row identity for nested fields (group, array, blocks)

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

Lontar introduces complex field types in Milestone 7: `group`, `array`, and `blocks` ([#151](https://github.com/handi7/lontar-cms/issues/151)).

Prior to this milestone, all fields defined in a collection or global were flat scalars or top-level relationships (`Record<string, Field>`), mapping directly to table columns or a dedicated junction table for `hasMany` relationships.

Complex fields introduce nested data structures:

1. `group`: A 1:1 nested object of named fields (`seo.metaTitle`, `seo.metaDescription`).
2. `array`: A 1:N ordered list of homogeneous rows (`gallery[i].image`, `gallery[i].caption`).
3. `blocks`: A 1:N ordered polymorphic list of heterogeneous rows (`layout[i] = { blockType: 'hero', ... } | { blockType: 'callToAction', ... }`).

These field types require fundamental architectural decisions before implementation begins:

- **Database storage**: Flattened SQL columns vs. relational child tables vs. JSON columns in MySQL (and future database adapters, M9).
- **Row identity**: How array and block items are identified across edits, renders, and version diffs.
- **Nested relationships and uploads**: How relational integrity and `depth` population work without native database foreign keys.
- **Querying**: Which nested paths can be filtered (`where`) and sorted (`sort`), and how they are validated.
- **Recursion and DoS limits**: Safeguards against unbounded memory usage and deeply nested structures.
- **Client configuration**: The serialized shape of recursive fields and whether `CLIENT_CONFIG_VERSION` bumps.
- **Downstream compatibility**: Ensuring the decisions support drafts/versions (M8) and localization (M11) cleanly.

## Decision

### 1. Storage Strategy: Flattened Columns for `group`, JSON Column for `array` and `blocks`

#### Top-level `group` fields use flattened columns

Top-level `group` fields map to prefixed SQL columns on the parent table using a double-underscore separator: `${groupName}__${subFieldName}` (e.g. `seo__meta_title`, `seo__og_image`).

- **Rationale**: A group has strict 1:1 cardinality with the document. Flattening maintains native database types (integers, datetimes, booleans), column-level nullability constraints, and indexability. Filtering and sorting on `seo.metaTitle` compiles directly to standard SQL expressions (`posts.seo__meta_title = ?`, `ORDER BY posts.seo__meta_title`) without requiring JSON path functions.
- If a `group` is nested inside an `array` or `blocks` item, it is stored naturally as a nested object within that row's JSON structure.

#### `array` and `blocks` fields use a single `json` column

Each `array` and `blocks` field is stored as a single `json` column on the parent collection table (`json('${fieldName}')` in Drizzle MySQL).

- **Why not child tables?**
  - **Table explosion**: A collection with a `layout` blocks field supporting 8 block types would require 8 separate child tables (e.g. `posts_layout_hero`, `posts_layout_cta`), each requiring its own schema migrations, foreign keys, and indexes.
  - **Read and write overhead**: Fetching a document with 10 heterogeneous blocks would require 9 queries or 8 `LEFT JOIN`s producing wide, sparse Cartesian products. In contrast, a JSON column requires exactly 1 row read and 1 row write.
  - **Reordering penalty**: Reordering blocks or array items in child tables requires multi-row `UPDATE _order` transactions. In JSON, reordering is an in-memory array manipulation persisted in a single document update.
  - **Schema migration agility**: Adding, modifying, or removing a block type requires zero SQL table migrations.
  - **Portability (M9)**: JSON column types are supported natively and consistently across MySQL (5.7+/8.0+), PostgreSQL (`jsonb`), and SQLite (JSON1/text).
  - **Drafts and Versions (M8)**: Storing blocks and arrays as JSON allows taking instantaneous document snapshots in a version history table without complex relational cloning.

### 2. Stable Row Identity for Array and Block Items

Every item inside an `array` or `blocks` field has a mandatory, stable `id`:

```ts
interface ArrayRow {
  id: string
  [field: string]: unknown
}

interface BlockRow {
  id: string
  blockType: string
  [field: string]: unknown
}
```

- **Format**: URL-safe string identifier (16-character hexadecimal string, e.g. `crypto.randomUUID().replace(/-/g, '').slice(0, 16)`).
- **Generation**:
  - The admin SPA generates an `id` client-side when adding a row (`useFieldArray`).
  - The server automatically generates an `id` during validation/sanitization if an item is created via REST or Local API without one.
  - The `id` is persistent across updates unless the row is explicitly deleted.
- **Reserved properties**: `id` is reserved for all array and block rows. `blockType` is reserved for block rows. Subfields cannot use these names.
- **Benefits**:
  - Stable React keys for list rendering and drag-and-drop reordering without DOM state bugs.
  - Granular diff computation in M8 (detecting which block was added, removed, or updated rather than diffing the whole list).
  - Fragment linking to specific page sections (e.g. `#block-<id>`).

### 3. Nested Relationships and Uploads inside JSON

`relationship` and `upload` fields may be declared inside `group`, `array`, and `blocks` definitions.

#### Depth Population

`@lontar/core`'s `populate` engine is updated to walk the field schema recursively:

1. `group`: Walks `doc[groupName]`.
2. `array`: Walks each item in `doc[arrayName]` against the array's subfield definitions.
3. `blocks`: For each item in `doc[blocksName]`, looks up the corresponding `block({ slug })` definition by `item.blockType` and walks its subfields.
4. **Batched fetching**: All target IDs collected across all nested levels are deduplicated and fetched in a single `db.find({ where: { id: { in: targetIds } } })` per target collection, retaining the existing $O(1)$ query batching per collection depth.
5. Populated documents replace the numeric ID in the returned document tree.

#### Target Deletion and Broken References

Because foreign key constraints cannot be attached to scalar values inside JSON columns:

- When a target document (e.g. an author or media asset) is deleted, existing references inside JSON columns remain stored as integer IDs.
- During query population with `depth > 0`, if a target document no longer exists (deleted or restricted by access control), `populate` safely sets the field to `null` (for single relations) or omits the ID from `hasMany` arrays.
- The API never throws 500 errors or fails queries due to orphaned references in JSON columns.

### 4. Querying and Validation: Where and Sort

#### Filter Path Resolution (`where`)

Filters support dot notation for nested fields:

- `where[seo.metaTitle][equals]=Hello`
- `where[gallery.caption][contains]=sunset`

`packages/core/src/query/validator.ts` validates dotted paths against `collection.fields`:

- For `group`: Resolves `${group}.${field}` and validates that the subfield exists.
- For `array`: Resolves `${array}.${field}` and validates that the subfield exists.
- For `blocks`: Resolves `${blocks}.${field}` and validates that the field is defined on at least one declared block for that blocks field.
- Unregistered paths or invalid operators return structured `400 Validation failed` errors (per ADR 0012).

#### Database Execution

- **`group` fields**: Compiled to the flattened column (`posts.seo__meta_title = ?`). Supports all standard comparison and pattern operators, as well as database indexes.
- **`array` and `blocks` fields**:
  - Filtering (`where`): Supported for scalar fields using MySQL JSON containment and extraction functions (e.g. `JSON_SEARCH` or `JSON_OVERLAPS` / `JSON_CONTAINS`).
  - Sorting (`sort`): **Explicitly disallowed** on array and blocks paths. Sorting a collection by an array of values is ill-defined in SQL and causes non-deterministic ordering. `validateSort` rejects paths within `array` or `blocks` with a `400` error. Group fields (`sort=seo.metaTitle`) are fully supported.

### 5. Limits and DoS Protection

To prevent excessive recursion, large payload attacks, and unindexed full-table scans:

1. **Maximum Schema Nesting Depth**: 3 levels maximum (e.g. `blocks` -> `block` -> `group` -> scalar field). `defineConfig` validates schema nesting and throws `LontarConfigError` if recursion exceeds 3 levels.
2. **Row Limits**:
   - `f.array` and `f.blocks` accept `minRows?: number` (default `0`) and `maxRows?: number` (default `100`, ceiling `500`).
   - Enforced in Zod validation schemas (`.min(minRows).max(maxRows)`) and in the admin SPA form controls.

### 6. ClientConfig Serialization and Version Bump

`packages/core/src/client/client-config.ts` extends `ClientField` to support recursive definitions:

```ts
export interface ClientGroupField extends ClientFieldBase {
  type: 'group'
  fields: ClientField[]
}

export interface ClientArrayField extends ClientFieldBase {
  type: 'array'
  minRows?: number
  maxRows?: number
  fields: ClientField[]
}

export interface ClientBlock {
  slug: string
  labels: { singular: string; plural: string }
  fields: ClientField[]
}

export interface ClientBlocksField extends ClientFieldBase {
  type: 'blocks'
  minRows?: number
  maxRows?: number
  blocks: ClientBlock[]
}
```

- **`CLIENT_CONFIG_VERSION`**: Bumped from `1` to `2` to signal recursive `ClientField` shapes to clients.
- `toClientConfig()` serializes nested fields recursively, ensuring all outputs remain plain JSON (ADR 0003).

### 7. Downstream Compatibility

- **M8 (Drafts, Versions & Publishing)**:
  Document snapshots in the `_versions` table store the entire document data as a JSON payload. Because `array` and `blocks` are stored in a single JSON column, versioning an entire page requires zero child-table cloning. Stable `id`s on rows enable clear semantic diffing.
- **M11 (Localization)**:
  Flattened `group` columns follow the collection's localization strategy (e.g. `seo__meta_title_en`), while `array` and `blocks` can be localized either at the container level (different layouts per locale) or at the block subfield level.

## Alternatives Considered

- **Child tables for `array` and `blocks`**:
  Rejected due to combinatorial complexity in schema migrations, the need for dynamic table creation per block type, excessive database joins during reads, multi-row update overhead during reordering, and extreme complexity for draft snapshots in M8.
- **JSON column for top-level `group`**:
  Rejected because groups have static 1:1 cardinality with the parent row. Storing groups in flattened columns keeps fields typed and directly sortable/filterable using standard SQL B-Tree indexes without virtual column generation.
- **Index-based array identity (no row `id`)**:
  Rejected because mutating, reordering, or inserting items in an array shifts indices, causing React rendering glitches and breaking draft diff algorithms.

## Consequences

### Easier

- Creating flexible page builders and modular layouts with `f.blocks()`.
- Capturing grouped metadata (e.g. SEO, OpenGraph) with full SQL query performance via `f.group()`.
- One-query reads and atomic updates for complex multi-block documents.
- Straightforward document versioning in M8 without child-table synchronization.
- Predictable, batched relationship population across arbitrary nested depths.

### Harder

- Relationships inside JSON columns do not have database-enforced foreign key cascade rules and rely on application-level resolution when targets are deleted.
- Querying inside JSON arrays requires database-specific JSON functions in the adapter.
- `ClientField` and form state management become recursive, requiring hierarchical field rendering in the admin SPA.
