# 0028: Localized content storage and the locale lifecycle

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Milestone 11 introduces multi-language content localization ([#149](https://github.com/handi7/lontar-cms/issues/149), [#420](https://github.com/handi7/lontar-cms/issues/420)). Editors must be able to:

1. Maintain content in multiple languages within the same document entity.
2. Mark specific fields as `localized: true` while keeping shared fields (e.g. status, author, SKU, pricing, dates) synchronized across all locales.
3. Query content in a specific locale, with automatic fallback to the default locale when a translation is missing.
4. Filter (`where`) and sort (`sort`) against localized fields with high database performance.
5. Save draft translations and preview them before publishing, without overwriting pending drafts in other languages.
6. Consume localized data through REST, Local API, webhooks, and the client-side admin SPA.

In prior architectural records, two distinct sketches were noted in passing:

- In ADR 0021 ([`docs/adr/0021-nested-field-storage.md`](0021-nested-field-storage.md) §7): Flattened `group` columns were sketched with locale suffixes (e.g. `seo__meta_title_en`).
- In ADR 0023 ([`docs/adr/0023-version-storage-and-drafts.md`](0023-version-storage-and-drafts.md) §10): Version snapshots were sketched storing localized dictionaries (e.g. `{ title: { en: 'Hello', id: 'Halo' } }`).

These sketches reflect two different levels of the system: physical database schema vs. canonical serialized document state.

This ADR resolves the fundamental architectural questions before writing any M11 code:

1. **Configuration**: The shape of the `localization` option in `defineConfig`, locale validation, and label presentation.
2. **Database storage**: Per-locale columns vs. a separate `_locales` table vs. JSON dictionaries per field.
3. **Nested fields**: Behavior of `localized` on containers (`group`, `array`, `blocks`) vs. subfields inside rows.
4. **Relationships & uploads**: Localized single relationships, localized `hasMany` junction tables, and media collections.
5. **Read semantics**: `locale`, `fallbackLocale`, `locale=all`, definition of "empty" for fallback, and behavior of `where`/`sort`.
6. **Write semantics**: Single-locale writes, `locale=all` writes, initial creation in non-default locales, and `required` validation.
7. **Drafts, versions & publishing**: Whether `_status` is per-document or per-locale, version snapshot shape, autosave isolation, and restoration.
8. **Hooks, access control & webhooks**: Locale threading through hooks, field-level access per locale, and webhook payloads.
9. **ClientConfig**: Serialization, admin communication, and `CLIENT_CONFIG_VERSION`.
10. **Upgrade & migration paths**: Safe schema transitions when enabling localization or toggling `localized` on existing data.

> **Scope Note:** Translating the admin UI itself (i18n of admin labels, buttons, and navigation) is explicitly **out of scope** for M11. M11 focuses solely on **content localization** (storing, querying, and editing multi-lingual content).

---

## Decision

### 1. Configuration: `localization` in `defineConfig`

Localization is configured globally at the root of `defineConfig`:

```ts
import { defineConfig, collection, fields as f } from '@lontar/core'

export default defineConfig({
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'id', label: 'Bahasa Indonesia' },
    ],
    defaultLocale: 'en',
    fallback: true, // boolean, default: true
  },
  collections: [
    collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true, localized: true }),
        slug: f.slug({ from: 'title', localized: true }),
        content: f.richText({ localized: true }),
        author: f.relationship({ relationTo: 'users' }), // shared
      },
    }),
  ],
})
```

#### Shorthand Locales Syntax

`locales` can be declared as an array of strings or an array of objects:

- `locales: ['en', 'id']` is normalized internally to `[{ code: 'en', label: 'EN' }, { code: 'id', label: 'ID' }]`.
- `locales: [{ code: 'en', label: 'English' }, { code: 'id', label: 'Bahasa Indonesia' }]` provides human-friendly labels for the admin UI switcher.

#### Validation Rules (Enforced by `defineConfig`)

- `defaultLocale`: Must match one of the codes declared in `locales`.
- `locales`: Must contain at least one locale. Codes must be unique.
- **Locale Code Format**: Codes must conform to BCP 47 simplified format: `^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$`, with a maximum length of 10 characters (e.g. `en`, `id`, `en-US`, `zh-CN`). Locale codes are validated against `^[a-z]{2,3}(-[A-Z]{2}|-[0-9]{3})?$` (case-normalized) and must **never** contain underscores, quotes, spaces, or SQL punctuation because they are used as database column suffixes.
- `fallback`: Optional boolean, defaults to `true`.
- **Field-level validation**: If any field declares `localized: true` while `localization` is not configured in `defineConfig`, a `LontarConfigError` is thrown at startup.

---

### 2. Database Storage Strategy: Per-Locale Columns

For top-level fields, flattened `group` fields, and globals, Lontar uses **per-locale columns** on the parent table.

For a collection `posts` with locales `['en', 'id']` and localized fields `title` and `slug`:

```
+------------------------------------------------------------------------------------+
|                                       posts                                        |
+------------------+------------------+----------------------------------------------+
| Column           | Type             | Purpose                                      |
+------------------+------------------+----------------------------------------------+
| id               | int PK auto_inc  | Unique document ID                           |
| title_en         | varchar(255)     | English title                                |
| title_id         | varchar(255)     | Indonesian title (nullable)                  |
| slug_en          | varchar(255)     | English slug                                 |
| slug_id          | varchar(255)     | Indonesian slug (nullable)                   |
| author_id        | int FK           | Shared non-localized relationship            |
| _status          | varchar(20)      | Document lifecycle ('draft' | 'published')   |
| created_at       | datetime         | Document creation timestamp                  |
| updated_at       | datetime         | Document last update timestamp               |
+------------------+------------------+----------------------------------------------+
Indexes:
  - UNIQUE (slug_en)
  - UNIQUE (slug_id)
  - (_status)
```

#### Why Per-Locale Columns Over Alternatives

1. **Zero Join Overhead (Public Read Performance)**:
   In ADR 0023 §4, public reads are designed to be ultra-fast single-table queries. A separate `_locales` table (`posts_locales`) would require `LEFT JOIN` on every read. When fallback is enabled, it requires either two joins (`posts_locales req` and `posts_locales fb`) or subqueries, severely degrading pagination and query performance.
2. **Native B-Tree Indexes on `where` and `sort`**:
   Filtering (`where: { slug: { equals: 'hello' } }`) and sorting (`sort: 'title'`) on `locale=en` translate directly to `WHERE slug_en = 'hello'` and `ORDER BY title_en`. Both MySQL and PostgreSQL execute these using standard B-tree indexes with zero CPU penalty. JSON dictionaries cannot be indexed without complex virtual generated columns.
3. **Native Unique Constraints**:
   A slug must be unique within its language (`slug_en` unique across English posts, `slug_id` unique across Indonesian posts). Per-locale columns allow native `UNIQUE INDEX posts_slug_en_idx (slug_en)` and `UNIQUE INDEX posts_slug_id_idx (slug_id)`. Standard SQL treats `NULL` values as distinct in unique indexes, so untranslated rows (`slug_id IS NULL`) never conflict.
4. **Seamless Flattening for `group` Fields (ADR 0021 §1)**:
   Nested `group` fields flatten cleanly into column names: `seo__meta_title_en` and `seo__meta_title_id`.
5. **Instant DDL for Adding Locales**:
   Both modern MySQL (InnoDB Instant ADD COLUMN) and PostgreSQL 11+ (metadata-only ADD COLUMN for nullable columns) execute `ALTER TABLE ... ADD COLUMN ...` as instant $O(1)$ operations without rewriting the table.
6. **Globals Compatibility**:
   Single-document globals store `site_title_en` and `site_title_id` in their dedicated table without requiring child tables.

---

### 3. Nested Fields: `group`, `array`, and `blocks`

#### A. `group` Fields

`group` fields are logical grouping containers flattened into database columns (ADR 0021 §1):

- If `group` has `localized: true`: All subfields inside the group inherit localization and generate per-locale columns (e.g. `seo__title_en`, `seo__title_id`).
- If `group` is not localized: Subfields inside the group can individually declare `localized: true` (e.g. `seo__title_en`, `seo__title_id` while `seo__og_image_id` remains shared).

#### B. `array` and `blocks` Fields (JSON Storage)

Per ADR 0021, `array` and `blocks` fields are stored in JSON columns. Localization can occur at one of two distinct architectural levels:

##### Level 1: Container-Level Localization (Different layouts per locale)

The entire `array` or `blocks` field declares `localized: true`:

```ts
layout: f.blocks({
  localized: true,
  blocks: [HeroBlock, CalloutBlock],
})
```

- **Database Schema**: Generates per-locale JSON columns: `layout_en json` and `layout_id json`.
- **Semantics**: Each language possesses its own list of blocks/rows, allowing different page structures, different block counts, or different block ordering between languages.
- **Rule**: If a container field is `localized: true`, subfields inside its rows/blocks **MUST NOT** declare `localized: true`. Doing so throws a `LontarConfigError`.

##### Level 2: Subfield-Level Localization (Identical structure, translated text)

The container field is shared (`localized: false` or omitted), but specific subfields inside rows/blocks declare `localized: true`:

```ts
gallery: f.array({
  fields: {
    image: f.upload({ relationTo: 'media' }), // shared image
    caption: f.text({ localized: true }), // translated caption
  },
})
```

- **Database Schema**: A single JSON column `gallery json`.
- **JSON Storage**: Inside each array item or block row, localized subfields store a dictionary of locales:
  ```json
  [
    {
      "id": "row_abc123",
      "image": 12,
      "caption": {
        "en": "Sunset over the mountains",
        "id": "Matahari terbenam di atas pegunungan"
      }
    }
  ]
  ```
- **API Read Projection**:
  - When read with `locale=en`, the adapter projects the row to `{ id: "row_abc123", image: 12, caption: "Sunset over the mountains" }`.
  - When read with `locale=all`, the adapter returns the full dictionary `{ id: "row_abc123", image: 12, caption: { en: "...", id: "..." } }`.
- **Querying**: Filtering on `where: { 'gallery.caption': { equals: 'Sunset over the mountains' } }` with `locale=en` targets JSON path `gallery[*].caption.en`.

---

### 4. Relationships and Upload Fields

#### A. Single `relationship` and `upload`

- If `localized: true`: Generates per-locale foreign key columns: `${name}_${locale}_id` (e.g. `featured_article_en_id`, `featured_article_id_id`, or `cover_image_en_id`, `cover_image_id_id`).
- If `localized: false`: Generates a single shared foreign key column `${name}_id`.

#### B. Localized `hasMany` Relationships

Collections with `hasMany: true` relationships use a dedicated junction table: `${collectionSlug}_${fieldName}` (e.g. `posts_tags`).

- If `localized: true`: The junction table adds a `_locale varchar(10) NOT NULL` column:
  ```
  +--------------------------------------------------------------------+
  |                             posts_tags                             |
  +------------------+------------------+------------------------------+
  | Column           | Type             | Purpose                      |
  +------------------+------------------+------------------------------+
  | id               | int PK auto_inc  | Junction row ID              |
  | parent_id        | int NOT NULL     | FK -> posts(id) ON DELETE CASCADE
  | tag_id           | int NOT NULL     | FK -> tags(id) ON DELETE CASCADE
  | _locale          | varchar(10)      | Locale code ('en', 'id')     |
  | order            | int NOT NULL     | Display sort order           |
  +------------------+------------------+------------------------------+
  Indexes:
    - (parent_id, _locale, order)
    - (parent_id, _locale, tag_id)
  ```
- Reads for `locale=en` query `WHERE parent_id = ? AND _locale = 'en' ORDER BY order`.
- Writes for `locale=en` delete and insert junction rows strictly for `(parent_id, _locale = 'en')`, leaving tags in other languages intact.
- If `hasMany` is not localized, the junction table omits the `_locale` column as today.

#### C. Upload (Media) Collections

In upload collections (collections with `upload: true`):

- The uploaded file itself (physical file, filename, mimeType, filesize, and storage URL) is shared across locales.
- Additional metadata fields defined on the upload collection (e.g. `alt: f.text({ localized: true })`, `caption: f.textarea({ localized: true })`) can be localized.

---

### 5. Read Semantics and Fallback

#### A. Query Parameters

The REST API and Local API accept the following parameters on collection, global, and version queries:

- `?locale=en`: Requests documents in the specified locale. If omitted, defaults to `config.localization.defaultLocale`. If an unknown locale code is provided, returns HTTP `400 Bad Request` with validation error code.
- `?fallbackLocale=id`: Specifies an explicit fallback locale.
- `?fallbackLocale=false` (or `'none'`): Disables fallback entirely. Missing fields return `null`.
- `?locale=all`: Returns documents where every localized field is an object containing all defined locales:
  ```json
  {
    "id": 1,
    "title": { "en": "Hello", "id": "Halo" },
    "slug": { "en": "hello", "id": "halo" },
    "author": 42
  }
  ```

#### B. Fallback Evaluation

Fallback is evaluated field-by-field. When reading `locale=id` with fallback enabled (default `fallbackLocale = defaultLocale`):
A field value in the requested locale triggers fallback if and only if it is **empty**:

- `null` or `undefined`
- `""` (empty string for text, textarea, slug, email)
- Empty richText structure (`{ type: "doc", content: [] }` or empty HTML)
- `[]` (empty array, for container-level localized `array`/`blocks`)
- `null` relation/upload ID

> **Important:** Boolean `false` and number `0` are valid values and **MUST NOT** trigger fallback.

#### C. `where` and `sort` Resolution: Direct Column Matching

In REST API and Local API queries:

- **`where` filters on localized fields resolve strictly against the requested locale column (`title_id`) without evaluating fallback.**
- **`sort` orders resolve strictly against the requested locale column (`title_id`) without evaluating fallback.**

**Why No SQL `COALESCE` in Queries:**
Evaluating fallback in SQL would require:

```sql
WHERE COALESCE(NULLIF(title_id, ''), title_en) = 'Hello'
ORDER BY COALESCE(NULLIF(title_id, ''), title_en) ASC
```

Wrapping indexed columns in `COALESCE` or `NULLIF` forces full table scans on both MySQL and PostgreSQL, completely defeating B-tree indexes and causing catastrophic performance degradation on large tables. Furthermore, sorting with dynamic fallback breaks deterministic pagination cursor and offset stability.
Direct column resolution ensures query execution remains instantaneous and predictable.

---

### 6. Write Semantics and Validation

#### A. Single-Locale Writes (`?locale=id`)

When writing to `POST /api/posts` or `PATCH /api/posts/:id` with `?locale=id`:

- The request body is a flat object: `{ title: "Halo", slug: "halo", author: 42 }`.
- The database write updates only the `title_id` and `slug_id` columns, plus shared non-localized columns (`author_id`, `updated_at`).
- Existing columns for other locales (`title_en`, `slug_en`) remain untouched.
- All writes execute inside a single transactional block (ADR 0009).

#### B. Multi-Locale Writes (`?locale=all`)

When writing with `?locale=all`:

- The request body accepts localized dictionaries: `{ title: { en: "Hello", id: "Halo" }, author: 42 }`.
- All specified locale columns are written in a single transaction.
- Useful for programmatic imports, data migrations, and automated translation syncing.

#### C. Initial Creation in Non-Default Locales

An editor may create a document directly in a non-default locale (e.g. `locale=id`).

- The parent row is inserted with `title_id = 'Halo'` and `title_en = NULL`.
- Creating in a non-default locale does **not** require immediate translation into the default locale.

#### D. Validation of `required: true`

- `required: true` on a localized field enforces that the field is non-empty **for the specific locale being written**.
- It does **not** reject writes because other locales are currently empty.
- When creating a document in `locale=id`, `required` fields for `id` must be present. The default locale `en` can be populated later.

---

### 7. Drafts, Versions, and Publishing Lifecycle (Interaction with ADR 0023)

#### A. Document-Level Lifecycle (`_status: 'draft' | 'published'`)

Lontar maintains **one `_status` for the whole document entity**:

- A document represents a single conceptual resource (e.g. BlogPost #42). The document is either published or in draft.
- The parent table (`posts`) **always holds the published content** (ADR 0023 §4).
- If a locale has not yet been published, its columns in the parent table are `NULL`.
- When a public visitor requests `GET /api/posts/42?locale=id`, because `title_id` is `NULL` in the parent table, fallback automatically serves `title_en`.

#### B. Version Snapshots Store the Canonical Multi-Locale Representation

In the dedicated versions table (`posts_versions`), the `snapshot` column (`json NOT NULL`) stores the full document with localized fields as dictionaries:

```json
{
  "id": 42,
  "_status": "draft",
  "title": {
    "en": "Published English Title",
    "id": "Draft Indonesian Translation in Progress"
  },
  "slug": {
    "en": "published-english-title",
    "id": "draft-indonesian-translation"
  },
  "author": 1
}
```

This fulfills the contract established in ADR 0023 §10 without altering the versions table schema.

#### C. Autosave and Draft Isolation Across Locales

- When an editor works in the admin on `locale=id` and autosave fires, the draft snapshot is updated by merging the new `id` values into the latest snapshot's `title.id`.
- Pending draft work in `locale=en` or other languages is **never overwritten** by edits in `locale=id`.
- Live preview (`?draft=true&locale=id`) resolves against the latest draft snapshot, showing the in-progress Indonesian translation, while public visitors continue seeing the live published content (or fallback).

#### D. Publishing and Restoration

- **Publishing**: When an editor publishes, the latest draft values for the document (including all translations currently present in the draft) are copied to the parent table columns (`title_en`, `title_id`), and `_status` is set to `'published'`.
- **Restoring a Historical Version**: Restoring a version restores the complete multi-locale state captured at that historical snapshot point.

---

### 8. Hooks, Access Control, and Webhooks

#### A. Lifecycle Hooks

All collection and global lifecycle hooks receive `locale` in their hook arguments:

- `beforeValidate({ data, operation, locale, req })`
- `beforeChange({ data, originalDoc, operation, locale, req })`
- `afterChange({ doc, previousDoc, operation, locale, req })`
- `afterRead({ doc, locale, req })`
- `beforeDelete({ id, locale, req })`
- `afterDelete({ doc, locale, req })`

#### B. Field-Level Access Control (ADR 0027)

- Field access rules (`read`, `create`, `update`) execute per field and receive `locale` in context.
- When reading `locale=en`, if access to a field is denied, the field is omitted from the document.
- When reading `locale=all`, if read access is denied for a localized field, the entire dictionary `{ en: '...', id: '...' }` is omitted.

#### C. Outgoing Webhooks (ADR 0024)

Webhook event payloads include the `locale` that triggered the event:

```json
{
  "event": "update",
  "collection": "posts",
  "id": 42,
  "locale": "id",
  "doc": {
    "id": 42,
    "title": "Halo Dunia",
    "slug": "halo-dunia"
  },
  "timestamp": "2026-11-19T05:50:00.000Z"
}
```

This enables frontend consumers (such as Next.js on-demand revalidation) to revalidate only the localized path:
`revalidatePath(`/${payload.locale}/posts/${payload.doc.slug}`)`.

#### D. Live Preview URL

The `admin.preview.url` function receives `locale`:

```ts
admin: {
  preview: {
    url: ({ doc, locale }) => `https://example.com/${locale}/preview/posts/${doc.slug}`,
  },
}
```

Or via template string: `https://example.com/{locale}/posts/{slug}`.

---

### 9. ClientConfig Serialization and Admin SPA

Per Architecture Rule 1 and ADR 0003, `ClientConfig` is plain JSON.

1. `ClientConfig` gains a top-level `localization` property:
   ```ts
   export interface ClientLocalizationConfig {
     locales: Array<{ code: string; label: string }>
     defaultLocale: string
     fallback: boolean
   }
   ```
2. Every `ClientField` gains `localized?: boolean`.
3. `toClientConfig()` serializes `localization` and the `localized` flag recursively through nested fields.
4. **`CLIENT_CONFIG_VERSION`**: Bumped from `2` to `3` to formally denote support for `localization` metadata and `localized` field properties.

---

### 10. Upgrade and Migration Paths

#### A. Enabling Localization on an Existing Project

When `localization` is enabled on an existing project and existing fields are marked `localized: true`:

- The CLI command `lontar migrate:create` generates a data-preserving migration:
  1. Add new locale columns (`ALTER TABLE posts ADD COLUMN title_id varchar(255) NULL`).
  2. Copy existing data into the default locale column (`ALTER TABLE posts RENAME COLUMN title TO title_en` or copy data then drop).
  3. Update unique indexes from `posts_slug_idx (slug)` to `posts_slug_en_idx (slug_en)`.
- The CLI **never** emits a destructive `DROP COLUMN` for fields undergoing localization transition.

#### B. Adding a New Locale

Adding a locale (e.g. `'fr'`) generates:

```sql
ALTER TABLE posts ADD COLUMN title_fr varchar(255) NULL;
ALTER TABLE posts ADD COLUMN slug_fr varchar(255) NULL;
CREATE UNIQUE INDEX posts_slug_fr_idx ON posts (slug_fr);
```

In MySQL 8 and PostgreSQL, this DDL executes instantaneously without locking the table or modifying existing rows.

#### C. Removing a Locale

Removing a locale from config prompts a confirmation warning during `lontar migrate:create`, alerting the developer before generating the `DROP COLUMN` statements.

---

## Alternatives Considered

- **Separate `_locales` table (`posts_locales`)**:
  Rejected. Every public read and admin list query would require `LEFT JOIN` operations across collections. When fallback is active, multiple joins or window functions are required. This degrades public read throughput, breaks index-backed sorting, and adds substantial complexity to the Drizzle adapter without providing benefits over instant DDL columns.
- **JSON Dictionary per Field in MySQL/Postgres (`title json`)**:
  Rejected. Storing `{ "en": "Hello", "id": "Halo" }` directly in the database column prevents native B-tree indexes, prevents native unique constraints on fields like `slug`, prevents database-enforced length constraints (`varchar(255)`), and complicates SQL full-text search.
- **Per-Locale `_status` Columns (`_status_en`, `_status_id`)**:
  Rejected. Non-localized fields (such as relationships, status, dates, and author) belong to the document entity. Having split statuses creates ambiguous document state (e.g. is document #42 public if `_status_en = 'published'` but `_status_id = 'draft'`). One document-level status keeps the lifecycle clean and prevents data leaks, while draft versions and `NULL` parent columns naturally handle unpublished translations.
- **Evaluating Fallback in SQL `where` and `sort` via `COALESCE`**:
  Rejected. `COALESCE` disables B-tree index scans, leading to severe query performance degradation. Direct column queries preserve maximum database performance.

---

## Consequences

### Easier

- **Uncompromised Read Performance**: Public queries remain single-table lookups with native B-tree indexes.
- **Type-Safe Development**: `lontar generate:types` outputs clean single-locale and multi-locale TypeScript definitions.
- **Predictable Editorial Workflow**: Editors can translate content at their own pace without risking draft leaks or breaking live translations.
- **Safe Database Migrations**: Adding languages is an instantaneous schema update without data loss.

### Harder

- **Schema Width**: Tables with many localized fields and many locales will have more columns. However, modern relational databases easily handle hundreds of nullable columns with negligible storage overhead.
- **Adapter Logic**: Both MySQL and Postgres adapters must dynamically construct per-locale column names and handle JSON extraction for localized subfields inside arrays and blocks.
