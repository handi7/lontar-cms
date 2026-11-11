# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-11

Drafts, version history and publishing (M8, tracked in #146). Editors can save without publishing, compare and restore earlier versions, autosave, and preview unsaved changes on the real frontend. Content changes can notify other services through signed webhooks. Everything here is opt-in per collection or global: a config written against 0.3.0 keeps working, except that a field can no longer be named `_status`. `@lontar/preview` is a new package. `@lontar/next`, `@lontar/storage-local` and `@lontar/storage-s3` have no changes of their own; they are published so their `@lontar/core` peer range moves with the rest.

### Upgrading

- A field named `_status` is rejected by `defineConfig` in every collection and global, whether or not it has drafts ([ADR 0023](docs/adr/0023-version-storage-and-drafts.md)). Rename it before upgrading.
- Turning on `versions` for an existing collection or global needs a migration: run `lontar migrate:create`, then `lontar migrate`. The migration adds a `<slug>_versions` table, and with `drafts` a `_status` column on the parent table.
- A new `_status` column defaults to `'draft'`, so rows that were already live would disappear from public reads. Add ``UPDATE `<table>` SET `_status` = 'published';`` to the migration. `migrate:create` prints a warning that names each table that needs it (#229, #283).

### Added

- `versions: { drafts: true }` on collections and globals. Documents get an engine-managed `_status` (`'draft' | 'published'`), the parent table always holds the published document, and pending draft edits live in `<slug>_versions`. Reads return published content by default; `draft: true` (Local API) or `?draft=true` (REST) returns the latest draft and requires update access ([ADR 0023](docs/adr/0023-version-storage-and-drafts.md)) (#198, #206).
- Version history: every save writes a snapshot, kept up to `versions.maxPerDoc` (default 50, `0` for unlimited). `GET /:id/versions`, a single version, and `POST /:id/versions/:versionId/restore` for collections and globals, plus `publish`, `unpublish`, `findVersions` and `restoreVersion` on the Local API. Version endpoints require read and update access (#199, #206, #226).
- `beforeValidate`, `beforeDelete` and `afterDelete` hooks. `beforeDelete` can abort a delete; `afterDelete` runs after the transaction commits (#200).
- `beforeChange` and `afterChange` receive `status`, `previousStatus` and `statusTransition`. With drafts on, they run on draft saves as well as publishes, so guard external side effects with `statusTransition === 'publish'` (#198, #244).
- Admin: a two-column edit layout with a document sidebar showing status and timestamps (#212); Save draft, Publish and Unpublish controls, and a status badge and status filter in the list view (#201); version history with a field-by-field compare and restore (#202).
- Admin autosave, enabled with `versions: { drafts: { autosave: true } }` or `{ autosave: { interval } }`. It debounces on edits, never writes to the published row, and a continuous editing session collapses into one autosave version instead of one per save (#203, #232, #252).
- Live preview: `admin.preview.url` is a URL template such as `https://mysite.com/posts/{slug}?preview=1`. The admin shows the page in an iframe beside the form and posts unsaved form state to it ([ADR 0024](docs/adr/0024-live-preview-and-webhooks.md)) (#204).
- `@lontar/preview`: a frontend helper that receives those updates, with `useLivePreview` for React in `@lontar/preview/react`. Updates are merged over `initialData`, so populated relationships survive (#204, #235, #285).
- Outgoing webhooks, configured at the root or per collection or global, on `create`, `update`, `change`, `publish`, `unpublish` and `delete`. They are delivered after the transaction commits, retried up to 3 times with backoff, and never fail the save. Requests carry `x-lontar-timestamp` and an HMAC-SHA256 `x-lontar-signature-256` over `${timestamp}.${body}`; `verifyWebhookSignature` from `@lontar/core` checks both, rejects a timestamp more than 5 minutes off, and returns `false` when the secret is missing. Set `includeDoc: true` to send the document (#205, #231, #242).
- `generate:types` adds `_status: 'draft' | 'published'` to collections and globals with drafts.
- `examples/next-blog` uses draft preview, live preview and webhook revalidation, covered by e2e (#207).

### Changed

- The admin edit form uses the two-column layout for every collection and global, including those without drafts (#212).
- With versions enabled, a field named `versions` is rejected, since it would collide with the `<slug>_versions` table (#241).
- Generated names for version table indexes and foreign keys are shortened with a hash when they would pass MySQL's 64-character limit (#241, #281).

### Fixed

Bugs found in review of the M8 work before release, none of which reached 0.3.0, are fixed here: draft saves overwriting the live row or dropping pending draft fields (#225, #238, #280, #284), draft uploads replacing published files (#228, #278), draft content leaking through `depth` population (#239), publish validation, locking and error mapping (#237, #240, #245, #277), webhooks firing before commit or not at all (#231, #247, #279), version numbering races (#243), the preview pane loading the wrong URL (#236), and admin autosave, restore, status badge and layout bugs (#230, #233, #234, #246, #261, #286–#288).

## [0.3.0] - 2026-11-09

Complex fields: `group`, `array` and `blocks`, with conditional fields on top of them (M7, tracked in #151). Documents can hold nested and repeating content, and the REST API filters, sorts and populates inside it. Configs written against 0.2.0 keep working, with one exception: a field name can no longer contain `__`. `@lontar/storage-local` and `@lontar/storage-s3` have no changes of their own; they are published so their `@lontar/core` peer range moves with the rest.

### Added

- `f.group()`: 1:1 nested fields. A top-level group is stored as flattened columns on the parent table (`seo__meta_title`), so its subfields keep their native types and stay indexable, filterable and sortable ([ADR 0021](docs/adr/0021-nested-field-storage.md)) (#154).
- `f.array()`: ordered rows of the same fields, with `minRows` and `maxRows`. Stored in one `json` column, and every row gets a stable `id` for React keys and for version diffing later (#155).
- `f.blocks()` and `block()`: ordered rows chosen from a list of declared block types, stored in one `json` column with a `blockType` on each row. `generate:types` emits the rows as a discriminated union (#156).
- `relationship` and `upload` fields work inside `group`, `array` and `blocks`, and `depth` populates them recursively (#157).
- `where` and `sort` take nested paths: `where[seo.metaTitle][equals]=…`, `where[gallery.caption][contains]=…`, `sort=seo.metaTitle`. A path into a blocks field can name the block (`layout.hero.heading`) or leave it out to match every block that declares the field. An unknown path returns the same structured 400 as any other invalid filter (#158).
- Conditional fields through `admin.condition`, written in the query filter syntax instead of a function so it survives serialization into `ClientConfig`. Inside `array` and `blocks` rows a condition resolves against sibling fields, or against the document with a `$root.` prefix. A hidden field is not required and is cleared on save ([ADR 0022](docs/adr/0022-conditional-fields.md)) (#159).
- `examples/next-blog` has a `pages` collection built from blocks, covered by e2e (#160).

### Changed

- A field name can no longer contain `__`, at any depth. It is the separator for group columns, so a field called `weird__name` collided with them and was dropped on read. `defineConfig` now rejects it and names the collection and field (#172).
- `CLIENT_CONFIG_VERSION` is 2, because `ClientField` is recursive. `@lontar/admin` and `@lontar/core` have to be on the same version, which their peer range already requires (#154).
- `depth` population is no longer cut off by the target collection's `pagination.maxLimit`. A document with more related rows than that limit used to come back with the rest missing (#173).
- A conditional field in the admin subscribes only to the paths its condition names, instead of watching the whole form and re-rendering on every keystroke (#177).

### Fixed

- A required field with an `admin.condition` got a `NOT NULL` column, and saving a document where the condition was false returned a 500. Conditional fields are nullable in the generated schema and in `generate:types` (#170).
- A filter path that named a block, such as `layout.hero.heading`, matched nothing instead of filtering (#171).
- `PATCH` did not enforce a required conditional field that the patch itself revealed (#174).
- Values of inactive conditional fields survived inside groups, arrays and blocks. They are cleared recursively now (#175).
- An array or blocks row written through the API got no row `id` when it sat inside another row (#176).
- `sort` validation split a nested path on a single underscore, so sorting on a field whose name contains one failed validation. It splits on `.` and `__` only (#178).
- `not_equals` on an array or blocks path dropped documents that were missing the key or held an empty or null array (#179).
- `array` and `blocks` fields in the admin started empty even with `minRows` set. They seed that many rows, each field at its default (#180).
- Admin field rows pointed at CSS variables that do not exist instead of the theme utilities, so some borders and muted text came out uncolored (#183).

## [0.2.0] - 2026-11-08

The admin moves to shadcn/ui on a scoped Tailwind v4 build, with Radix primitives and a dark theme (M6, tracked in #123). Nothing changes outside `@lontar/admin`: the API, the database, the config and the values the admin sends are the same as in 0.1.2. The other packages are bumped to keep every `@lontar/*` version in step.

### Added

- Dark mode for the admin. It follows the operating system by default, and editors can pick Light, Dark or System in the sidebar. The choice is stored in `localStorage` under `lontar-admin-theme`. Dark is a second set of values for the same `--lontar-*` tokens, so there are no new tokens to learn. A host can theme dark mode through the selectors documented in the README ([ADR 0020](docs/adr/0020-admin-dark-mode.md)) (#121).
- Date fields use a calendar popover with a time input. Checkboxes and select fields use Radix Checkbox and Select. The value each one sends is unchanged, and tests pin it across four time zones (#117, #118).
- Deleting a document asks for confirmation in a dialog instead of `window.confirm`, and Cancel sends no request (#136).
- The relationship and upload pickers show their search results in a popover instead of pushing the fields below them down. Their icon buttons have tooltips (#136).
- A contributing guide (`CONTRIBUTING.md`), and labels added to pull requests automatically (#130).

### Changed

- The admin is built from shadcn/ui components on Tailwind v4. Every utility is prefixed `lt:`, Tailwind's preflight is not shipped, every rule is scoped to `.lontar-admin`, and portalled content renders inside that wrapper. A build step fails if any selector could reach the host page ([ADR 0019](docs/adr/0019-admin-shadcn-tailwind-scoping.md)) (#113–#116, #119).
- Most of the admin's hand-written `lontar-*` class names are gone, and the ones that remain are internal. The supported way to theme the admin is still the `--lontar-*` custom properties documented in the README. If your app styled the admin through its class names, move those overrides to the tokens.
- The sidebar stays in view while the page scrolls, and its menu scrolls on its own (#140).

### Fixed

- Global CSS on the host page, such as Tailwind v3's preflight or Bootstrap's reboot, no longer overrides the admin's borders, button backgrounds or typography. The admin's stylesheet ships its reset and utilities outside cascade layers, and the e2e suite now loads a host reset over the admin (#143).

## [0.1.2] - 2026-11-06

Post-release fixes for 0.1.1: CLI, admin, uploads, and config validation. This is the first version published from GitHub Actions, with npm provenance.

### Added

- `lontar` CLI commands load `.env` and `.env.local` before reading the config, and accept `--env-file <path>`. Variables already set in the environment take precedence (#58).
- Packages are now published by a release workflow with npm trusted publishing, so every tarball carries a provenance attestation. CI also installs the packed tarballs outside the monorepo and checks every export, bin and type declaration before release (#92).
- README documents the `baseURL` option of `createRouteHandlers` and `createLontar` (`LONTAR_URL` in `.env.example`), which silences Better Auth's "Base URL is not set" warning (#99).
- README documents the admin's CSS theme tokens and how to override them (#124, thanks @Doomguy-BFG9000 for the first outside contribution).

### Changed

- `defineConfig` now rejects `relationship` fields whose `relationTo` is not a collection slug, global `upload` fields that point at a collection without uploads, and `slug` fields whose `from` is not a text-like field in the same collection or global. Configs with these mistakes used to fail later, at request time (#65).
- A collection without `admin.useAsTitle` now uses its first `text`, `email` or `slug` field as the title (then `filename` for upload collections, then `id`). The admin list, search and relationship pickers use that title instead of the id (#61).
- `@lontar/db-mysql` no longer depends on `drizzle-kit`. It was never imported at runtime, and its `esbuild` build script made pnpm 11 fail with `ERR_PNPM_IGNORED_BUILDS` (#97).
- `@lontar/core` loads `sharp` only when an image is resized, so importing core no longer requires sharp's native binary (#67).

### Fixed

- `lontar create-user` never exited, because the database pool stayed open. The CLI now closes it after `create-user` and `migrate`, including when they fail (#98).
- The `lontar` CLI did nothing on Windows (#58).
- `lontar migrate:create` could not resolve `drizzle-orm` under pnpm unless the project installed it directly (#96).
- Admin: pagination, search, filters, sorting, form state and alerts carried over when switching between collections or globals (#60).
- Admin session handling (#62):
  - documents cached for the previous user are cleared on logout or user change
  - a 401 response redirects to the login page
  - a failed sign-out keeps you signed in instead of pretending to succeed
  - after login you land on the page in `?redirect=`, and the back button no longer loops between redirects
- Admin form edge cases (#63):
  - optional upload fields can be cleared
  - blank optional text fields with `minLength` are accepted
  - an empty rich text field fails `required`, and the editor no longer marks the form dirty on mount
  - Enter in a picker search no longer submits the form
  - the same file can be picked again after removing it
  - a background refetch no longer overwrites unsaved edits
- Admin error feedback (#64):
  - failed deletes in the list view show an error
  - failed quick uploads in the upload picker show an error, and its file input only accepts the collection's allowed MIME types
  - a failed list request no longer also shows the "create the first document" empty state
- Image uploads respect EXIF orientation when storing width and height, and animated GIF and WebP images keep all their frames when resized (#66).
- Admin: React logged "useInsertionEffect must not schedule updates" on every navigation in Next.js apps, and Tiptap warned about `immediatelyRender` (#100).

## [0.1.1] - 2026-11-03

First release published to npm. v0.1.0 was tagged but never published, so this is the first installable version of the `@lontar/*` packages.

### Added

- MIT license for the repository and every package ([ADR 0018](docs/adr/0018-license-mit.md)) (#89).
- npm package metadata (`description`, `keywords`, `repository`, `homepage`, `bugs`, `engines`, `publishConfig`) and a README for each package (#90).

### Changed

- `@lontar/next` and `@lontar/cli` now list `@lontar/core` as a peer dependency (a `^` range) instead of pinning an exact version, so a project can't end up with two copies of core (#67).
- `@lontar/admin` no longer installs the libraries it bundles (TanStack, Tiptap, react-hook-form, zod). Its only runtime dependency is `@tanstack/history`, used for the `history` prop type, and `@lontar/core` is now a peer dependency (#91).

### Fixed

- `@lontar/admin` type declarations no longer import paths from the monorepo's source tree, which left `AdminSession`, `AdminUser` and related types as `any` after install (#91).
- `@lontar/admin` no longer ships `vite.config.d.ts` and `vitest.config.d.ts` (#91).
- `lontar --version` printed `v0.0.0`. It now reports the installed package version.

## [0.1.0] - 2026-11-03

Initial release of Lontar Headless CMS (v0.1 MVP).

### Highlights

- **TypeScript-First & Code-First**: Schema is defined in a single `lontar.config.ts` configuration file. TypeScript types, REST API endpoints, Drizzle database tables, and the admin panel UI are fully generated from config.
- **Client-Side SPA Admin**: Admin panel (`@lontar/admin`) is a pure client-side Vite + React SPA that consumes serialized `ClientConfig` without React Server Components or leaking server-side logic/secrets.
- **Framework-Agnostic Core**: The CMS engine is powered by Hono REST route handlers, easily mountable in Next.js (`@lontar/next`), standalone Node.js, or serverless environments.
- **Local API**: First-class `getLontar(config)` local API with strongly-typed `find`, `findByID`, `create`, `update`, `delete`, `findGlobal`, and `updateGlobal` for server-side queries.
- **Production-Ready Demo**: Complete Next.js blog example (`examples/next-blog`) showcasing authentication, rich text editing, responsive image presets, category relationships, and full Playwright E2E coverage.

### Added

- **Core & Schema Engine (`@lontar/core`)**:
  - `defineConfig`, `collection`, and `global` schema builders.
  - Granular collection-level access control (`read`, `create`, `update`, `delete`).
  - Document lifecycle hooks (`beforeChange`, `afterChange`, `afterRead`).
  - Globals support for single-document singleton configurations (e.g., site settings, navigation menus).
  - Shared validation engine compiling field definitions directly into Zod schemas.
  - Safe serialization via `toClientConfig()` ensuring client purity (no functions, secrets, or server instances sent to admin).
- **Field Types**:
  - `text`: single-line string with `maxLength`, `required`, and default value support.
  - `textarea`: multi-line text input with `maxLength`.
  - `number`: numeric input with integer / float validation, min/max limits.
  - `checkbox`: boolean toggle with default values.
  - `select`: enumerated option selection with option labels.
  - `date`: ISO datetime handling with timezone-consistent storage and UTC normalization.
  - `email`: email-formatted string validation.
  - `slug`: auto-generated, URL-friendly unique identifier derived from title/name fields.
  - `richText`: structured WYSIWYG editor powered by Tiptap with JSON AST storage.
  - `relationship`: single and many-to-many (`hasMany`) relations with relational integrity.
  - `upload`: file/media relationship linking documents to upload collections with automated size variants.
- **Database Adapter (`@lontar/db-mysql`)**:
  - MySQL database adapter built on top of Drizzle ORM.
  - Transactional write operations wrapping document updates and junction table synchronization.
  - Database error mapping converting raw SQL constraint violations into user-friendly validation errors.
  - Junction tables for `hasMany` relationships with ordered indexing and cascade deletions.
- **Admin Panel SPA (`@lontar/admin`)**:
  - Built with Vite, React 19, Tailwind CSS, TanStack Table, and Lucide icons.
  - Authentication flow with login view, session persistence, and protected routes.
  - Collection list view with pagination, search, and dynamic column formatting.
  - Edit/Create forms with React Hook Form, Zod client validation, and real-time error messages.
  - Interactive relationship picker with modal selection and search.
  - Upload picker and media library manager with preview cards and size variants.
  - Tiptap rich text editor toolbar with headings, lists, quotes, code, and inline formatting.
- **Authentication (`Better Auth`)**:
  - Integrated Better Auth engine with secure `httpOnly` session cookies.
  - Initial admin user bootstrapping on first run.
  - Protected API route handlers verifying session tokens.
- **File Uploads & Image Processing**:
  - `@lontar/storage-local`: Local filesystem storage adapter with static file serving.
  - `@lontar/storage-s3`: S3-compatible cloud storage adapter (AWS S3, MinIO, Cloudflare R2).
  - Image pipeline using Sharp for automatic thumbnail, medium, and hero variant generation.
  - Atomic cleanup rolling back uploaded files if database insertion or lifecycle hooks fail.
- **Command Line Interface (`@lontar/cli`)**:
  - `lontar migrate`: Applies pending schema migrations.
  - `lontar migrate:create`: Compiles schema changes into versioned Drizzle SQL migration files.
  - `lontar generate:types`: Generates strictly typed TypeScript interfaces (`lontar-types.ts`) with module augmentation for auto-complete and type safety.
  - `lontar create-user`: Command-line administrative user creation.
- **Next.js Adapter (`@lontar/next`)**:
  - Catch-all route handler (`app/api/[...lontar]/route.ts`) bridging Next.js App Router and Hono engine.
  - Admin SPA page mounting under `app/admin/[[...path]]/page.tsx`.
- **Developer Experience & Tooling**:
  - Isolated test database creation (`TEST_DATABASE_URL`), protecting local development databases from being wiped during test runs.
  - Parallel test execution in Vitest.
  - Docker Compose configuration with MySQL 8.4 and automatic test database initialization.
