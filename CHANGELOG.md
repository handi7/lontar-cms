# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-11-06

Post-release fixes for 0.1.1: CLI, admin, uploads, and config validation. This is the first version published from GitHub Actions, with npm provenance.

### Added

- `lontar` CLI commands load `.env` and `.env.local` before reading the config, and accept `--env-file <path>`. Variables already set in the environment take precedence (#58).
- Packages are now published by a release workflow with npm trusted publishing, so every tarball carries a provenance attestation. CI also installs the packed tarballs outside the monorepo and checks every export, bin and type declaration before release (#92).
- README documents the `baseURL` option of `createRouteHandlers` and `createLontar` (`LONTAR_URL` in `.env.example`), which silences Better Auth's "Base URL is not set" warning (#99).
- README documents the admin's CSS theme tokens and how to override them (#124).

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
