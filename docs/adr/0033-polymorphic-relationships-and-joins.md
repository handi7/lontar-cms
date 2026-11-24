# 0033: Polymorphic relationships and join fields

- **Status:** Accepted
- **Date:** 2026-11-24
- **Accepted:** 2026-11-24 ([#503](https://github.com/handi7/lontar-cms/issues/503))

## Context

Milestone 13 focuses on content model completeness ([#500](https://github.com/handi7/lontar-cms/issues/500)). Prior to this milestone, relationships in Lontar were strictly monomorphic: a `relationship` field could only specify a single target collection slug (`relationTo: 'authors'`).

Two major architectural gaps exist in real-world schema modeling:

1. **Polymorphic relationships**: A field needs to reference documents belonging to one of several target collections (for example, an `owner` that can be either a `user` or an `organization`, or an `activity` referring to a `post`, `comment`, or `page`).
2. **Reverse / Join relationships**: Collections lack a native way to surface documents that point back to them (for example, viewing an `author`'s list of `posts`, or a `category`'s associated `products`) without manual application-side queries.

This ADR resolves the storage, validation, query execution, and admin presentation contracts for:

- **Polymorphic relationships**: `relationTo: ['authors', 'organizations']`.
- **Virtual join fields**: `f.join({ collection: 'posts', on: 'author' })`.

---

## Decision

### 1. Polymorphic Relationships

#### Field Definition

A relationship field becomes polymorphic when `relationTo` is an array of collection slugs:

```ts
f.relationship({
  relationTo: ['authors', 'organizations'], // polymorphic
  hasMany?: boolean,                        // optional, default: false
  required?: boolean,
})
```

- When `relationTo` is a string (`'authors'`), it remains a standard monomorphic relationship. All existing single-target relationships continue working unchanged.

#### Data Shape

Polymorphic relationships store a typed reference object:

```ts
// Single polymorphic relationship
interface PolymorphicValue {
  relationTo: string
  value: number
}

// hasMany polymorphic relationship
type PolymorphicHasManyValue = PolymorphicValue[]
```

- **In API responses (depth: 0)**: Returns `{ relationTo: 'authors', value: 42 }`.
- **In API responses (depth >= 1)**: Returns `{ relationTo: 'authors', value: { id: 42, name: 'Alice', ... } }`.
- When `hasMany: true`, returns an array of these objects: `[{ relationTo: 'authors', value: 42 }, { relationTo: 'organizations', value: 10 }]`.

#### Database Storage

1. **Top-level Single Polymorphic Relationships**:
   - Flattened into two dedicated columns on the parent table:
     - `${fieldName}__relation_to`: `varchar(255)` storing the target collection slug.
     - `${fieldName}__id`: `int` / `bigint` storing the target document primary key.
   - **Rationale**: Keeps native relational integer types, avoids JSON serialization overhead, and enables database-level B-tree indexing on `${fieldName}__id` and `${fieldName}__relation_to`.
2. **Top-level `hasMany` Polymorphic Relationships**:
   - Stored in a dedicated junction table `${parentTable}_${fieldName}` with columns:
     - `id`: auto-incrementing primary key.
     - `parent_id`: foreign key to parent document `id`.
     - `relation_to`: `varchar(255)` identifying the target collection.
     - `target_id`: integer primary key of the target document.
     - `_order`: integer index preserving user ordering.
   - **Rationale**: Preserves the existing junction table pattern used by monomorphic `hasMany` relationships, ensuring scalable indexing and cascade consistency.
3. **Nested Inside `group`**:
   - Flattened with group prefixes: `${groupName}__${fieldName}__relation_to` and `${groupName}__${fieldName}__id`.
4. **Nested Inside `array` or `blocks`**:
   - Stored naturally within the item's JSON object: `{ [fieldName]: { relationTo: 'authors', value: 42 } }`.

#### Population (`depth`) and Batching

When populating documents with `depth > 0`:

1. **Collection-grouped batching**: The population engine walks polymorphic references, groups all target IDs by their respective `relationTo` collection, and executes **exactly one query per target collection**:
   `db.find(targetCollection, { where: { id: { in: collectedIds } } })`.
   This maintains strict $O(1)$ database query batching per collection depth.
2. **Access control & row constraints**: Each target collection query enforces that collection's `read` access and row-level constraints (ADR 0030 §7).
3. **Missing or restricted targets**: If a target document was deleted, is unpublished (during published reads per ADR 0023), or is blocked by row-level access:
   - For single relationships: `value` becomes `null` (`{ relationTo, value: null }`).
   - For `hasMany`: The entry is omitted from the array.
   - The query never throws or leaks existence (ADR 0021 §3, ADR 0030 §7).

#### Querying (`where`)

Polymorphic fields support dotted paths for filtering:

- `where[owner.relationTo][equals]=authors`
- `where[owner.value][equals]=42`
- Both adapters compile these to the corresponding flattened columns or junction table joins.

---

### 2. Virtual `join` Fields

#### Field Definition

A `join` field is a virtual, read-only field that automatically queries and embeds documents from a target collection that reference the current document:

```ts
f.join({
  collection: 'posts',    // target collection that points to this document
  on: 'author',           // relationship field name on the target collection
  limit?: number,         // default: 10, maximum allowable: 100
  sort?: string,          // e.g. '-publishedAt'
  where?: Where,          // optional static filter on the target collection
})
```

#### Virtual, Read-Only Semantics

- **No database column**: A `join` field produces zero SQL columns or tables.
- **Ignored on writes**: Payloads sent to `create` or `update` with a `join` field key are silently stripped/ignored.
- **Excluded from version history and webhook diffs**:
  - `_versions.snapshot` does **not** store joined documents. Storing joined collections inside version snapshots would cause massive data duplication and snapshot bloat.
  - Webhooks emit mutations of the document itself; joins are dynamic views and not part of the document's stored change payload.

#### Response Shape

In REST API and Local API responses, a `join` field returns an object containing the matching documents and total count:

```ts
interface JoinResult<TDoc> {
  docs: TDoc[]
  totalDocs: number
}
```

- When `depth: 0`: Returns `{ docs: [], totalDocs: count }` (avoiding expensive joins when only count is requested).
- When `depth >= 1`: Fetches and populates the joined documents up to `limit`.

#### Batched Loading (Anti-N+1 Protection)

When querying lists of documents containing `join` fields (e.g. `GET /api/authors?limit=25`):

- Executing a separate subquery per author would create an $N+1$ query bottleneck.
- **Batched lookup**: The query engine collects all parent IDs from the page (`[1, 2, ..., 25]`).
- It executes a **single batched query** against the target collection:
  ```ts
  db.find(targetCollection, {
    where: {
      and: [
        { [on]: { in: parentIds } },
        joinWhere,
        targetCollectionAccessConstraints,
        publishedFilter,
      ],
    },
    limit: hardCapTotal,
    sort: joinField.sort,
  })
  ```
- The returned documents are partitioned in memory by their reference ID and attached to the corresponding parent document.

#### Cycles and Termination

If `posts` joins `authors` and `authors` joins `posts`:

- Each hop across a `join` or relationship decrements `depth`.
- When `depth` reaches `0`, nested documents are not traversed further, cleanly terminating circular references.

#### Target Field Types for `on`

The `on` parameter on `join` may reference:

1. A standard single `relationship` field on the target collection.
2. A `hasMany` `relationship` field on the target collection.
3. A polymorphic `relationship` field on the target collection (query automatically adds `where: { [on + '.relationTo']: currentCollection }`).

#### Draft and Published State Isolation

When serving published requests (`draft=false` or omitted):

- The joined query automatically includes `{ _status: { equals: 'published' } }` for collections with versions enabled.
- Draft documents are never leaked through join fields to unauthorized or public visitors (ADR 0023).

---

### 3. Cross-cutting Behaviors

#### Content Localization (`localized`)

- **Polymorphic relationships**:
  - Single: Flattened per-locale columns `${fieldName}__relation_to_${locale}` and `${fieldName}__id_${locale}`.
  - `hasMany`: Junction table includes a `_locale` column when `localized: true` is configured (ADR 0028).
- **Join fields**:
  - `join` fields cannot be marked `localized: true` because they hold no stored data.
  - They execute joined queries using the request's active `locale`.

#### Field-Level Access Control

- Polymorphic fields support `access: { read, create, update }` (ADR 0027).
- `join` fields support `access: { read }`. If `read` is denied, the join field is omitted from the response.

#### DoS Limits and Result Capping

- `limit` on `join` has a default of `10` and a hard ceiling of `100` (ADR 0014).
- `defineConfig` validates that `limit <= 100`.

#### TypeScript Types & Typegen (`generate:types`)

`packages/cli` generates union types for polymorphic relations and join responses:

```ts
// Polymorphic relation
type OwnerField =
  { relationTo: 'authors'; value: number } | { relationTo: 'organizations'; value: number }

// Populated polymorphic relation (depth > 0)
type PopulatedOwnerField =
  { relationTo: 'authors'; value: Author } | { relationTo: 'organizations'; value: Organization }

// Join field
interface AuthorPostsJoin {
  docs: Post[]
  totalDocs: number
}
```

---

## Consequences

### Positive

- Solves complex relational modeling (polymorphism and reverse lookups) with clean, declarative syntax.
- Anti-N+1 batching prevents performance degradation on list queries.
- Read-only nature of `join` fields guarantees zero schema migration churn and eliminates duplicate snapshot bloat in version history.
- Seamlessly integrates with row-level constraints (ADR 0030) and draft isolation (ADR 0023).

### Negative / Trade-offs

- Single polymorphic relationships require two flattened columns per field (`__relation_to` and `__id`).
- Deeply nested join queries require memory partitioning during batched reads.

---

## Out of Scope

- Joining through paths deeply nested inside `array` or `blocks`.
- Direct mutation of joined documents via the parent document's edit endpoint.
- Database-level foreign keys across polymorphic targets (not natively supported by standard relational engines).

---

## Implementation Plan

Tracked in [#500](https://github.com/handi7/lontar-cms/issues/500):

1. **#503**: This ADR and README API documentation.
2. **#511**: Polymorphic relationships in core and both adapters:
   - Config typing and `relationTo: string[]` support.
   - Column generation for single (`__relation_to` and `__id`) and junction tables for `hasMany`.
   - Polymorphic query resolution and batch population.
3. **#512**: Admin polymorphic relationship picker:
   - Collection type selector and document search.
4. **#513**: `join` field implementation in core and both adapters:
   - `f.join` builder function and validation.
   - Batched query execution on `find` and `findByID`.
   - Cycle termination by `depth`.
5. **#514**: Admin edit form rendering for join fields:
   - Read-only list display of joined items with links to target edit screens.
