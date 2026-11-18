# 0027: Field-level access control

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Lontar implements collection-level and global-level access control ([ADR 0006](0006-default-access-control.md)), where operations (`read`, `create`, `update`, `delete`) default to requiring an authenticated user (`({ user }) => Boolean(user)`).

However, real-world CMS applications require restricting individual fields within a collection or global:

- Sensitive properties (e.g., customer email, internal editorial notes, billing metadata) must be hidden from public API callers or lower-privilege roles like authors and contributors.
- Protected fields (e.g., view counts, publish dates, author assignment, verification flags) should be readable by editors but writable only by administrators or backend hooks.
- Complex nested fields (`group`, `array`, `blocks` via [ADR 0021](0021-nested-field-storage.md)) need granular access rules for child fields and sub-properties.

Field-level access control touches every read and write pipeline, nested field traversal, relationship population (`depth`), version histories and diffs, query filtering and sorting, admin UI state, and TypeScript type generation.

Furthermore, field-level access must adhere to Lontar's core architectural tenets:

1. **Server/client split (Architecture Rule 1):** The admin never imports server functions or executes server-only access checks.
2. **Plain data field definitions (ADR 0003):** `ClientConfig` delivered to the admin must remain strictly plain JSON.
3. **Defense in depth:** Restrictions must be enforced on all side doors (query filters, sorting, versions, relationships).

This ADR defines the design, semantics, and implementation contracts for field-level access control.

---

## Decision

### 1. Public API: `access` on Field Definitions

Every field type (`text`, `number`, `textarea`, `select`, `date`, `relationship`, `upload`, etc.), including fields nested within `group`, `array`, and `blocks`, supports an optional `access` declaration:

```ts
import { collection, fields as f } from '@lontar/core'

export const Posts = collection({
  slug: 'posts',
  fields: {
    title: f.text({ required: true }),
    content: f.richText(),
    // Internal editorial notes: only admin and editor can read or write
    editorialNotes: f.textarea({
      access: {
        read: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
        create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
        update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
      },
    }),
    // View counter: readable by anyone, modifiable only by server/admin
    views: f.number({
      defaultValue: 0,
      access: {
        read: () => true,
        create: ({ user }) => user?.role === 'admin',
        update: ({ user }) => user?.role === 'admin',
      },
    }),
  },
})
```

#### Function Signatures and Arguments

```ts
export interface FieldAccessArgs<TData = unknown, TSiblingData = unknown, TDoc = unknown> {
  user: AuthUser | null
  id?: string | number
  data?: TData
  siblingData?: TSiblingData
  doc?: TDoc
}

export type FieldAccessFunction = (args: FieldAccessArgs) => boolean | Promise<boolean>

export interface FieldAccess {
  read?: FieldAccessFunction
  create?: FieldAccessFunction
  update?: FieldAccessFunction
}
```

- `user`: The authenticated user object or `null` for anonymous callers.
- `id`: The document ID (available during `read` and `update`; omitted during `create`).
- `data`: The top-level input payload or document data.
- `siblingData`: In nested structures (`group`, `array`, `blocks`), the specific row or nested object containing the field. For top-level fields, `siblingData` equals `data`.
- `doc`: The existing persisted document before mutation (available during `update` and `read`; omitted during `create`).

#### Coexistence with ADR 0003 and Architecture Rule 1

- Field definitions in `lontar.config.ts` are evaluated strictly on the server.
- The `toClientConfig()` serializer strips the `access` property from each field definition when producing `ClientConfig`.
- The admin SPA receives clean JSON containing field shapes, labels, and UI options, preserving ADR 0003. Access permissions are communicated to the admin via a dedicated permissions endpoint (see Section 5).

### 2. Read Semantics: Omission and Pipeline Order

#### Pipeline Order: Hooks First, Field Sanitization Last

1. The database query retrieves the raw document.
2. `afterRead` collection hooks execute with the **complete** document, ensuring server-side calculations (e.g. aggregating totals or deriving public values) have access to all raw attributes.
3. Field access sanitization runs immediately prior to returning the document to the caller:
   - For every field where `field.access.read` evaluates to `false`, the property is omitted (`delete sanitizedDoc[fieldName]`) from the returned JSON.
   - For nested structures (`group`), unreadable subfields are omitted from the object. If all fields in a group are unreadable, the group key remains an empty object or omitted.
   - For lists (`array`, `blocks`), each row or block is traversed and unreadable subfields are stripped per row.

#### Side-Door Protection

- **Populated Relationships (`depth`):** When populating related documents via `depth >= 1`, target collection documents are recursively sanitized according to the target fields' `read` access rules.
- **Globals:** Unreadable global fields are removed from `GET /api/globals/:slug` and `getLontar().findGlobal()`.
- **Version History and Snapshots:** When an authorized user inspects past versions (`GET /api/:collection/:id/versions` and `/versions/:versionId`), fields the caller cannot read are stripped from the snapshot.
- **Version Snapshots and Diffs:** Version retrieval endpoints (`GET /api/:collection/:id/versions` and `GET /api/:collection/:id/versions/:versionId`) sanitize snapshots by stripping fields the caller cannot read. The admin UI computes version diffs client-side from these sanitized snapshots, eliminating the need for a dedicated server diff endpoint while guaranteeing that unauthorized field changes are never disclosed.
- **Webhook Payloads:** By default, webhooks are triggered by the server with system authority (`overrideAccess: true`). However, tenant-scoped or external subscriber feeds execute with sanitized projections.

### 3. Write Semantics: Silent Drop and Constraint Handling

#### Silent Drop for Forbidden Fields

When an update or create request includes fields for which the caller does not have `create` or `update` access:

- **Decision: Forbidden fields are silently dropped from the input data.**
- _Rationale:_ In standard CMS operations, users submit existing documents via admin forms. If a user has permission to edit the post `content` but not `views` or `editorialNotes`, throwing `403 Forbidden` on every form save would require clients to perform complex client-side field diffing before submitting. Dropping unpermitted fields ensures the existing database values for those protected fields remain untouched.

#### Interactions with Constraints and Lifecycle

- **`required: true` fields:**
  - If a caller lacks `create` access on a required field, the field must either define a `defaultValue` or be populated by a server hook (`beforeValidate` / `beforeChange`).
  - If neither provides a value, write validation fails with a validation error (`400 Bad Request`), preventing incomplete records from being stored.
- **`slug.from` fields:**
  - If a user lacks `update` access to a `slug` field, modifying the source field (`from: 'title'`) will not mutate the protected `slug`.
- **Nested write-only subfields:**
  - Inside `group`, `array` and `blocks`, a subfield the caller may update but not read behaves like a top-level write-only field: an explicit incoming value is written, and an omitted value keeps the stored one. A subfield the caller cannot update always keeps its stored value.
- **Drafts and Autosave:**
  - In draft mode (`_status = 'draft'`), write access rules apply identically. Autosave payloads containing forbidden fields have those fields stripped before writing the draft snapshot.
- **Version Restore:**
  - When restoring a document to a prior version (`POST /api/:collection/:id/versions/:versionId/restore`), the restore operation evaluates the current caller's `update` access for each field. Values for fields the caller cannot update are discarded, preserving the document's current field values.

### 4. Query Filtering and Sorting: Oracle Prevention

Allowing arbitrary queries against unreadable fields allows attackers to leak hidden values through timing or binary search conditions (e.g. `?where[secretKey][like]=a%` or `?where[salary][greater_than]=50000`).

- **Decision: The query validator rejects `where` filters and `sort` parameters targeting fields the current caller cannot read.**
- If a query includes a filter or sort on a forbidden field, the API immediately returns `400 Bad Request` with standard Lontar validation error structure:
  ```json
  {
    "error": "Validation failed",
    "message": "Field 'salary' cannot be filtered or sorted by current user",
    "issues": [
      {
        "path": "salary",
        "message": "Field 'salary' cannot be filtered or sorted by current user"
      }
    ]
  }
  ```
- This applies to top-level fields and nested JSON filter paths (`seo.keywords`, `arrayField.subField`).
- Query validation has no document to evaluate against. A field whose `read` function inspects `doc` (or `id`) is therefore treated as unreadable for filtering and sorting, since its result could differ per document and would leak through the query.

### 5. Admin Permissions Endpoint

To enable dynamic form rendering without violating Architecture Rule 1:

- The server exposes permissions endpoints:
  - `GET /api/_lontar/permissions` (collection & global summary)
  - `GET /api/_lontar/permissions/:collection/:id` (document-specific permissions, also supported via `GET /api/_lontar/permissions?collection=:collection&id=:id`)
  - `GET /api/_lontar/permissions/globals/:global` (global-specific permissions)

#### Document-Specific Evaluation Context

When querying document-specific permissions via `GET /api/_lontar/permissions/:collection/:id`:

- `id` and `doc` (the existing document retrieved from the database) are passed into `read`, `update`, and `delete` access functions.
- `create` access functions (both collection-level and field-level) are evaluated **without** `id` or `doc` (receiving `{ user, req, siblingData }`), matching the execution context of actual document creation where no database record exists yet.

#### Response Schema

```ts
export interface FieldPermission {
  read: boolean
  create: boolean
  update: boolean
}

export interface CollectionPermission {
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
  fields: Record<string, FieldPermission>
}

export interface PermissionsResponse {
  collections: Record<string, CollectionPermission>
  globals: Record<
    string,
    { read: boolean; update: boolean; fields: Record<string, FieldPermission> }
  >
}
```

#### Admin UI Behavior

- **Field Hidden (`read: false`):** The input component is completely omitted from the edit form, list view columns, and view filters.
- **Field Locked (`read: true, update: false`):** The input component renders in a read-only or disabled state with a subtle padlock indicator explaining that the field cannot be modified by the current user.

### 6. TypeScript Type Safety and Typegen

- Generated collection types (`lontar generate:types`) retain the complete schema shape (e.g., `interface Post { title: string; salary?: number }`).
- Fields with custom read access are **not** unconditionally converted to optional `?` types in the base model.
- _Rationale:_ The Local API operates with `overrideAccess: true` by default, where all fields are consistently present. Forcing optionality on all protected fields damages developer ergonomics across trusted server operations.

### 7. Performance and Error Handling

- **Sync and Async:** Access functions can be either synchronous or asynchronous (`boolean | Promise<boolean>`).
- **Per-Request Memoization:** If an access function does not reference `data` or `doc` (inspecting only `{ user }`), the result is cached per field per request to avoid redundant evaluations across paginated query lists.
- **Error Handling (Fail Closed):** If a custom access function throws an unhandled exception, Lontar catches the error, logs a warning on the server, and treats the result as `false` (Deny by default).

### 8. Scope Boundary: Row-Level Constraints

- **Deferred to M12:** Returning dynamic database `where` expressions from access functions (e.g. `read: ({ user }) => ({ author: { equals: user.id } })`) is deferred to Milestone 12.
- In M10, access functions return boolean outcomes (`boolean | Promise<boolean>`). Row-level restrictions in M10 continue to be enforced through query parameters and `beforeChange` lifecycle hooks.

### 9. Local API and Internal Overrides

- `getLontar({ overrideAccess: true })` bypasses all collection and field access checks.
- Passing `{ overrideAccess: false, user }` to Local API operations enforces both collection-level and field-level access control identically to REST API requests.

---

## Consequences

### Positive

- **Granular Security:** Enforces least-privilege data access across all API surfaces and fields.
- **Oracle Elimination:** Prevents data leakage through malicious query filters and sort directives.
- **Resilient Form UX:** Silently dropping forbidden fields prevents accidental validation errors during admin document saves.
- **Strict Server/Client Integrity:** Admin SPA remains pure client-side while receiving precise field display and edit permissions.

### Negative / Tradeoffs

- **Evaluation Overhead:** Evaluating access functions per field introduces processing overhead on large paginated datasets; mitigated through per-request memoization.
- **Static Type Limitations:** Static TypeScript types represent the schema rather than dynamic runtime visibility.

---

## Implementation Plan

1. **#337 (This issue):** Record ADR 0027, update README spec, update `docs/scope.md`.
2. **#339:** Implement field access evaluation engine in `@lontar/core`, including read sanitization, silent write drops, query validator checks, and nested field support.
3. **#340:** Implement `GET /api/_lontar/permissions` endpoints in `@lontar/core`.
4. **#341:** Integrate field permissions in `@lontar/admin` to hide unreadable fields and lock read-only fields.
5. **#347:** Add end-to-end tests for field-level access in `examples/next-blog`.
