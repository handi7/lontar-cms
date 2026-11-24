# 0032: Layout fields — tabs, row, and collapsible

- **Status:** Accepted
- **Date:** 2026-11-24
- **Accepted:** 2026-11-24 ([#502](https://github.com/handi7/lontar-cms/issues/502))

## Context

Milestone 13 focuses on content model completeness ([#500](https://github.com/handi7/lontar-cms/issues/500)). As collections and globals grow to handle production content requirements, edit forms often contain dozens of fields. Rendering all fields in a single, unorganized vertical column creates cluttered editing experiences, slows down editor workflows, and causes visual fatigue.

To structure complex editing screens, Lontar introduces three **layout fields**:

1. `tabs`: Organizes fields into distinct tab panels (e.g. "Content", "SEO", "Settings").
2. `row`: Aligns fields horizontally side-by-side (e.g. `firstName` and `lastName`, or `lat` and `lng`).
3. `collapsible`: Groups fields inside an accordion panel that editors can expand or collapse.

In Lontar, `collection.fields` and `group.fields` are defined as `Record<string, Field>` (objects keyed by field name). Before implementing layout fields, fundamental questions regarding data representation, naming rules, query paths, and admin UX must be settled:

- **Data shape**: Are layout fields presentational-only (transparent to data storage), or do they introduce nested objects?
- **Name collisions**: How are field names scoped when distributed across tabs or rows?
- **Nesting permissions**: Can layout fields be nested inside `group`, `array`, `blocks`, and inside each other?
- **ClientConfig**: The serialized structure sent to the admin SPA.
- **Cross-cutting behaviors**: `admin.condition`, `access`, `localized`, and form validation error handling.

---

## Decision

### 1. Data Shape: Presentational Only

Layout fields (`tabs`, `row`, `collapsible`) are **purely presentational UI containers**. They are completely transparent to data storage and document APIs:

- **No SQL columns or JSON object wrappers**: The key assigned to a layout field in `fields` (e.g. `mainTabs: f.tabs(...)` or `nameRow: f.row(...)`) is solely an identifier in the config and `ClientConfig`. It **never** appears in database tables, stored JSON columns, REST API responses, Local API queries, or version snapshots.
- **Children flatten into the parent data**: All child fields defined inside a tab, row, or collapsible container flatten directly into the enclosing document, `group`, or `array`/`blocks` row object.
- **Distinction from `group`**: If a developer intends to create a nested object namespace in the data (e.g. `doc.seo.metaTitle`), they declare a `f.group(...)` (ADR 0021). A layout field never creates a data namespace.

```ts
// Config
const Posts = collection({
  slug: 'posts',
  fields: {
    layout: f.tabs({
      tabs: [
        {
          label: 'Content',
          fields: {
            title: f.text({ required: true }),
            content: f.richText(),
          },
        },
        {
          label: 'Settings',
          fields: {
            author: f.relationship({ relationTo: 'users' }),
            publishedAt: f.date(),
          },
        },
      ],
    }),
  },
})

// Stored / API Document Shape (Notice 'layout' is not in the data!)
interface PostDoc {
  id: number
  title: string
  content: Record<string, unknown>
  author: number | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}
```

### 2. Name Collisions and Validation

Because all child fields flatten directly into the enclosing parent scope:

- **Field names must be globally unique within that scope**: Two child fields cannot share the same name, even if they are in different tabs of the same collection or inside different rows. A child field also cannot share a name with a sibling field declared outside the layout.
- **Example violation**: Declaring a field named `description` inside the "Content" tab and another field named `description` inside the "SEO" tab is an error.
- **Config validation in `defineConfig`**: During configuration validation, `@lontar/core` walks all layout containers recursively and registers every encountered child field name. If any duplicate field name is discovered in the same scope, `defineConfig` immediately throws a `LontarConfigError` identifying the colliding field name and the containers involved.

### 3. Nesting Rules

Layout fields may nest flexibly to enable expressive form layouts:

- **Where layout fields may be declared**:
  - At the root level of `collection.fields` and `global.fields`.
  - Inside `group.fields`.
  - Inside `array.fields`.
  - Inside `block.fields` (within `blocks`).
- **Nesting inside each other**:
  - A `row` may be placed inside a `tab` or `collapsible`.
  - A `collapsible` may be placed inside a `tab`.
  - A `tabs` field may be placed inside a `collapsible` (though nesting tabs within tabs is discouraged for usability).
- **Depth limit**: Layout nesting depth is capped at **3 levels** (e.g., `tabs` -> `collapsible` -> `row`), enforced during config validation to prevent unmanageable UI hierarchies.

### 4. ClientConfig Serialization

`ClientConfig` is updated to serialize layout structures so the admin SPA can construct the UI hierarchy:

```ts
export interface ClientTab {
  label: string
  description?: string
  fields: ClientField[]
}

export interface ClientTabsField extends ClientFieldBase {
  type: 'tabs'
  tabs: ClientTab[]
}

export interface ClientRowField extends ClientFieldBase {
  type: 'row'
  fields: ClientField[]
}

export interface ClientCollapsibleField extends ClientFieldBase {
  type: 'collapsible'
  label: string
  initiallyCollapsed?: boolean // default: false
  fields: ClientField[]
}
```

- In `toClientConfig()`, layout fields serialize their child fields recursively using the existing `toClientField` pipeline.
- Unit tests in `packages/core/src/config/to-client-config.test.ts` will verify the serialized output for all three layout types.
- The `CLIENT_CONFIG_VERSION` bump to `4` (planned for M13 in ADR 0031) covers these new types.

### 5. Cross-cutting Behaviors

#### Conditional Fields (`admin.condition`)

- `admin.condition` can be specified on layout containers (`tabs`, `row`, `collapsible`, or individual tab items).
- If the condition evaluates to `false`, the entire container (or individual tab) is hidden from the edit form.
- When an entire tab or container is hidden, its contained fields are not submitted or evaluated during client-side form interactions, consistent with ADR 0022.

#### Access Control

- **Layout containers do not declare `access`**: Access control operates on stored data and operations (ADR 0027). Since layout fields store no data, they do not accept `access.read`, `access.create`, or `access.update`.
- Child fields within a layout declare their own `access` rules.
- If all fields within a tab or collapsible container are hidden from the current user due to `access.read: false`, the admin SPA automatically hides that empty tab or collapsible section from the UI.

#### Localization (`localized`)

- **`localized: true` is forbidden on layout fields**: Layout containers store no data and cannot be localized. Attempting to set `localized: true` on `tabs`, `row`, or `collapsible` throws a `LontarConfigError`.
- Child fields declared inside layout containers may be marked `localized: true` individually, behaving exactly as standard localized fields (ADR 0028).

#### Validation Errors on Hidden Tabs (Admin UX)

One of the most critical usability pitfalls in tabbed form interfaces occurs when a required field on an unselected tab fails validation: if the tab provides no visual indicator, editors can become stuck without understanding why their save was rejected.

To solve this:

1. **Error badges on tabs**: The admin tab component subscribes to React Hook Form's form state. When any field within a tab has a validation error, that tab's header displays an error badge or warning indicator with the count of invalid fields.
2. **Auto-focus on first error**: On form submission failure, the admin SPA automatically switches the active tab to the first tab containing an invalid field and scrolls the field into view.

---

### 6. Unaffected Systems

Because layout fields are strictly presentational:

- **Database Schemas & Migrations**: Neither MySQL (`db-mysql`) nor PostgreSQL (`db-postgres`) creates tables or columns for layout fields. Drizzle schema generation transparently traverses layout containers and generates columns only for real data-bearing fields.
- **Query Paths (`where` and `sort`)**: Dotted query paths never mention layout containers. For instance, filtering on `title` uses `where[title][equals]=...`, never `where[mainTabs.title]`.
- **TypeScript Types & Typegen (`lontar generate:types`)**: The generated TypeScript document interfaces (`InferDoc`) do not include layout container keys. Child properties appear directly at their data scope.

---

## Consequences

### Positive

- Enables clean, organized editing workflows for documents with large schemas.
- Preserves absolute simplicity in database schemas and query filtering: zero migration cost, zero SQL overhead, zero join complexity.
- Clear mental model: `group` is for data nesting; `tabs`/`row`/`collapsible` are for visual layout.
- Form error indicators prevent editors from getting trapped by hidden validation failures.

### Negative / Trade-offs

- Child field names cannot be repeated across tabs in the same collection, even if conceptually separated by tabs.
- Layout fields cannot hold independent data-level hooks or access control.

---

## Out of Scope

- Named tabs that construct a nested JSON object (use `f.group` instead).
- Dynamic tabs created at runtime by users (use `f.blocks` or `f.array` instead).
- Drag-and-drop tab reordering by editors.

---

## Implementation Plan

Tracked in [#500](https://github.com/handi7/lontar-cms/issues/500):

1. **#502**: This ADR and README API documentation.
2. **#509**: Layout fields in `@lontar/core`:
   - `f.tabs`, `f.row`, and `f.collapsible` builder functions.
   - Schema validation in `defineConfig` (checking for field name collisions, duplicate keys, invalid `localized` flags, and recursion limits).
   - `toClientConfig` serialization and tests.
   - Transparent schema traversal for adapters and operations.
3. **#510**: Admin layout rendering in `@lontar/admin`:
   - `TabsLayout`, `RowLayout`, and `CollapsibleLayout` form components.
   - Validation error badges on tab headers.
   - Auto-switching to the first invalid tab on submit failure.
