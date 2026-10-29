# Lontar: Scope (v0.1)

This document defines what v0.1 is and isn't. The target public API lives in [`../README.md`](../README.md); architecture decisions live in [`adr/`](adr/).

## Summary & problem

Lontar is an open source, TypeScript-first headless CMS: you define your schema in config, the API and admin panel are generated for you, and the admin is a pure SPA that isn't tied to any framework.

**Problems it solves:**

- Code-first CMSs like Payload v3 are now tightly coupled to the Next.js App Router and RSC, so every Next upgrade affects the CMS.
- GUI-based CMSs (Strapi, Directus) keep the schema in the database rather than in code, which makes it hard to review and version in Git.
- Developers running MySQL in a Next.js/React stack need a lightweight CMS they can simply mount into an existing app.

**Target users:** TypeScript/React developers building websites or internal apps for clients who want their content schema to live in code.

**Positioning vs Payload:** the same code-first, config-driven approach. The difference is that Lontar's admin is an SPA (Vite + React) and the engine runs on Hono, so it can be mounted in Next.js, standalone Node, or other runtimes.

## Design principles

1. **The config is the product.** A single `lontar.config.ts` is the source of truth for the DB schema, validation, API, admin, and TypeScript types.
2. **Strict server/client split.** `defineConfig()` runs only on the server. The admin receives a serialized `ClientConfig` from an endpoint, with no functions, hooks, or credentials.
3. **Framework-agnostic.** The engine is a Hono app that can be mounted anywhere. Next.js is just one adapter.
4. **One validation schema.** Field definitions compile to a Zod schema used on both the server and the admin forms.
5. **End-to-end type safety.** Collection types are generated from the config by the CLI, so frontend queries are fully typed.
6. **Use mature libraries, don't reinvent them.** Drizzle for the DB, Better Auth for auth, Tiptap for rich text.

## MVP scope (v0.1)

The MVP is done when one real website can be fully managed through Lontar: collections, simple relationships, image uploads, and admin login.

| Area | Included in v0.1 |
| --- | --- |
| Config | `defineConfig`, `collections`, `globals` (single documents, e.g. site settings) |
| Fields | `text`, `textarea`, `number`, `checkbox`, `select`, `date`, `email`, `slug`, `richText` (Tiptap), `relationship` (one-way, single/many), `upload` |
| Database | MySQL via Drizzle, migrations generated from config via the CLI |
| API | REST: list (filter, sort, pagination), get, create, update, delete; `depth` param to populate relationships |
| Auth | Email + password login for admin users via Better Auth, httpOnly session cookie |
| Access control | `read`, `create`, `update`, `delete` functions per collection (no field-level yet) |
| Hooks | `beforeChange`, `afterChange`, `afterRead` per collection |
| Uploads | Local storage + S3-compatible adapter, image resizing with Sharp |
| Admin | Login, collection dashboard, list view (TanStack Table), create/edit forms, globals editing |
| DX | `lontar migrate` and `lontar generate:types` CLI commands, Next.js adapter |

## Non-goals

The following are intentionally left out of v0.1 so the MVP can ship in 2–3 months.

- **Complex fields:** `array`, `blocks`, `group`, and conditional fields. Targeted for v0.2.
- **Versions, drafts, and live preview.**
- **Localization** (multi-language content).
- **GraphQL API.** REST only for now.
- **Field-level access control** and complex role-based permissions.
- **Databases other than MySQL.** The adapter architecture is in place, but Postgres/SQLite come later.
- **Visual page builder** or drag-and-drop editor.
- **Public plugin system.** Internal hooks are enough for now.
- **Multi-tenancy** and cloud hosting.

## Open questions & next steps

"Lontar" is a working name, and each decision below should be recorded as an ADR once it's made.

**Open questions**

- Should fields be defined as an object (`fields: { title: ... }`) or an array like Payload? An object is easier for type inference; an array makes ordering and admin layout easier.
- How are custom admin components registered: through a client-side registry, or import paths resolved at build time?
- DB schema: one table per collection with a column per field, or store some fields as JSON (e.g. rich text and, later, blocks)?
- Stored rich text format: Tiptap JSON, HTML, or both?
- License: MIT or Apache-2.0?

**Next steps**

- [ ] Finalize the project name and check npm package name availability
- [ ] Review the config example in the README and iterate until it feels good to use
- [ ] Write ADRs for the first 3 decisions: SPA admin, Drizzle + MySQL, `ClientConfig` format
- [ ] Set up the monorepo (pnpm + Turborepo) with `core`, `db-mysql`, `admin`, `next`, `cli` packages
- [ ] Walking skeleton: a `posts` collection with `text` and `number` fields, working end-to-end from config to the admin edit form
- [ ] Break the MVP scope table into milestones and issues in GitHub Projects
