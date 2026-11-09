# AGENTS.md

Context for AI coding agents working on this repo. Read this first, then follow the pointers below for detail.

## Project

Lontar (working name) is an open source, TypeScript-first headless CMS. Schema is defined in a config file; the REST API, admin panel, DB migrations, and TypeScript types are generated from it.

It takes Payload's code-first approach, with two deliberate differences:

- The admin is a **pure client-side SPA** (Vite + React). No React Server Components.
- The engine is a **Hono app**, so it mounts in Next.js, standalone Node, or other runtimes. Next.js is just one adapter.

Detailed docs:

- `docs/scope.md`: summary, design principles, MVP scope, non-goals
- `README.md`: the target public API (config, mounting, querying). Treat it as the spec.
- `docs/adr/`: architecture decision records. Read the relevant ADR before changing anything it covers.

## Stack

- Monorepo: pnpm workspaces + Turborepo
- Language: TypeScript (strict), ESM only
- DB: Drizzle ORM, MySQL first (adapter interface must allow Postgres/SQLite later)
- Validation: Zod, generated from field definitions and shared by server and admin
- API: Hono (REST)
- Auth: Better Auth, httpOnly session cookie
- Uploads: Sharp for resizing, local storage + S3-compatible adapter
- Admin: Vite, React, TanStack Router, TanStack Query, TanStack Table, React Hook Form, Tiptap
- Admin styling: shadcn/ui components copied into `packages/admin/src/components/ui`, on Tailwind v4 with every utility prefixed `lt:` and no preflight, scoped to `.lontar-admin` (ADR 0019); light and dark themes on `--lontar-*` tokens (ADR 0020)
- Build: tsdown/tsup for packages
- Tests: Vitest (unit/integration), Playwright (admin e2e)

## Packages

```
packages/
  core/          defineConfig, field definitions, CRUD operations, hooks, access control, Local API
  db-mysql/      Drizzle-based MySQL adapter, schema generation, migrations
  storage-local/ Local disk storage adapter
  storage-s3/    S3-compatible storage adapter
  admin/         Vite + React SPA, ships prebuilt JS + scoped CSS
  next/          Next.js adapter (route handlers)
  cli/           lontar migrate, migrate:create, generate:types
examples/
  next-blog/     Example app used for manual and e2e testing
```

## Architecture rules (do not break)

1. **Server/client split.** `defineConfig()` and everything it holds (hooks, access functions, DB adapter, secrets) is server-only. The admin never imports the config. It fetches a serialized `ClientConfig` from `GET /api/_lontar/config`.
2. **`ClientConfig` is plain JSON.** No functions, no class instances, no env values. Add a `toClientConfig()` test whenever a field type gains new options.
3. **Admin is client-only.** No RSC, no `server-only` imports, no Next.js-specific APIs inside `packages/admin`.
4. **Core is framework-agnostic.** `packages/core` must not import Next.js or React.
5. **One source of validation.** Field definitions compile to Zod schemas. Do not hand-write separate validation for the server and the admin.
6. **DB access goes through the adapter interface.** Core never imports Drizzle directly.
7. **Admin CSS is scoped.** Prefix or container-scope all styles so they don't leak into the host app.

## Non-goals for v0.1

Do not implement these unless the current milestone says so: `array`/`blocks`/`group`/conditional fields, versions/drafts/live preview, localization, GraphQL, field-level access control, non-MySQL databases, visual page builder, public plugin system, multi-tenancy. Full list in `docs/scope.md`.

## Commands

```bash
pnpm install      # install workspace dependencies
cp .env.example .env

pnpm db:up        # start MySQL via docker-compose.yml, wait until healthy
pnpm db:down      # stop it

pnpm build        # turbo: build every package
pnpm dev          # turbo: watch-build every package
pnpm typecheck    # turbo: tsc --noEmit per package
pnpm test         # vitest across all packages (uses TEST_DATABASE_URL, safe for dev data)
pnpm lint         # eslint
pnpm format       # prettier --write
pnpm format:check # prettier --check

pnpm pack:packages <dir>   # pnpm pack every public package into <dir> (run pnpm build first)
pnpm smoke:packages <dir>  # install those tarballs outside the workspace and check imports, bins, types
```

Integration tests connect using `TEST_DATABASE_URL` (defaults to `mysql://lontar:lontar@127.0.0.1:3306/lontar_test`). Each test file dynamically creates and drops its own isolated database (`lontar_test_<hex>`), completely protecting the local development database (`DATABASE_URL`).

Packages build with tsdown, except `admin`, which is a Vite library build.
`publint` runs as part of each tsdown build, so a `package.json` whose `exports`
disagree with the build output fails the build rather than the install.

`pnpm install` sets up a Husky pre-commit hook that runs lint-staged (eslint --fix and
prettier on staged files only). CI (`.github/workflows/ci.yml`) runs
`format:check` → `lint` → `typecheck` → `build` → pack + smoke test → `test` → e2e on every PR
and on pushes to `main`.

Releases are published by `.github/workflows/release.yml` when a `vX.Y.Z` tag is pushed, after
approval on the `npm` environment. Don't run `pnpm publish` by hand; see `docs/releasing.md`.

## Conventions

- Public APIs must match `README.md`. If an implementation needs a different API, propose the README change first instead of silently diverging.
- Every new field type needs: definition, Zod schema, DB column mapping, `ClientConfig` serialization, admin input component, and tests.
- Prefer small, focused PRs per milestone task.
- ESLint caps `complexity` at 10 and `sonarjs/cognitive-complexity` at 15. Split the function instead of disabling the rule; if a disable is truly needed, say why in a comment next to it.
- React components declare props as a named `interface <Component>Props`, never as an inline type on the destructured parameter. Where a component only forwards its props onward, take `props` whole, destructure what it reads in the body, and forward the rest with `{...props}`. Existing inline annotations are being converted in #181.
- Admin styling goes through the theme utilities that `packages/admin/src/styles.css` maps in `@theme inline` — `lt:border-border`, `lt:text-muted-foreground`, `lt:bg-card`. Never write `lt:*-[var(--lontar-…)]`: an arbitrary value accepts any name, so a token that doesn't exist produces a `var()` that silently resolves to nothing. Reach for a raw token only when it has no `@theme` mapping, and then use the v4 shorthand `lt:border-(--lontar-border)`. See #183 for what the arbitrary form cost us.
- Record significant decisions as a new ADR in `docs/adr/NNNN-title.md` (context, decision, consequences).

## Milestones roadmap to MVP (v0.1)

- [x] **M0: Repo setup + walking skeleton** (Done)
- [x] **M1: Standard Fields & Validation** (Done)
  - [x] #14 `fields: implement textarea, email, and slug field types`
  - [x] #15 `fields: implement checkbox, select, and date field types`
- [x] **M2: Auth & Access Control** (Done)
  - [x] #16 `auth: integrate Better Auth for admin authentication and session management`
  - [x] #17 `access: implement collection-level access control (read, create, update, delete)`
  - [x] #18 `admin: add login page and authenticated route protection`
- [x] **M3: Query Filtering, Hooks & Globals** (Done)
  - [x] #19 `api: implement advanced query filtering and sorting in REST API`
  - [x] #20 `hooks: implement collection hooks (beforeChange, afterChange, afterRead)`
  - [x] #21 `globals: support single-document globals in config, DB, REST API, and admin`
- [x] **M4: Rich Text & Relationships** (Done)
  - [x] #22 `fields: implement richText field with Tiptap editor`
  - [x] #23 `fields: implement relationship field (single and hasMany)`
  - [x] #24 `api: support depth query param to populate relationships in REST API`
  - [x] #25 `admin: relationship picker component in edit forms`
- [x] **M5: Uploads, Typegen & v0.1 Release** (Done)
  - [x] #26 `uploads: implement storage adapters (local & S3) and Sharp image resizing`
  - [x] #27 `fields: implement upload field type and media collection handling`
  - [x] #28 `cli: implement lontar generate:types command`
  - [x] #29 `examples/next-blog: complete real blog demo with auth, media, and rich text`
  - [x] Code review fixes that must land before release (checklist and fix order in #69)
    - [x] Security: #44, #45, #46, #47, #48
    - [x] Data integrity: #49 (done), #50 (done), #51 (done), #52 (done), #53 (done), #54 (done), #56 (done), #57 (done)
    - [x] Needed for #29: #59 (done), #68 (done)
    - [x] Tooling: #55 (done)
- [x] **v0.1.x: Post-release fixes** (after v0.1; checklist in #69)
  - [x] Admin UX: #60 (done), #61 (done), #62 (done), #63 (done), #64 (done)
  - [x] Other: #58 (done), #65 (done), #66 (done), #67 (done)

- [x] **M6: Admin styling with shadcn/ui + scoped Tailwind v4** (Done; tracking in #123)
  - [x] #113 Styling ADR (done)
  - [x] #114 Scoped Tailwind build and token mapping (done)
  - [x] #115 Primitives and scoped portal container (done)
  - [x] #116 Non-portal components (done; part 1 in #133)
  - [x] #117 Portal components (done; Select only, the rest moved to #136)
  - [x] #118 Date and checkbox fields (done)
  - [x] #119 Radix unit test setup (done)
  - [x] #120 Admin e2e updates (done, with #117)
  - [x] #121 Dark mode (done; system default with an in-admin toggle, ADR 0020)
  - [x] #122 Theming token documentation and Stack correction (done)
  - [x] #136 Dialog, Popover and Tooltip where they replace existing behaviour (done)

- [ ] **M7: Complex fields** (feature work done, tracking in #151; code review fixes open)
  - [x] #152 ADR: nested field storage and querying (done)
  - [x] #153 ADR: declarative conditional fields (done)
  - [x] #154 `group` field (done)
  - [x] #155 `array` field (done)
  - [x] #156 `blocks` field (done)
  - [x] #157 Relationship and upload fields inside nested fields (done)
  - [x] #158 Filter and sort on nested field paths (done)
  - [x] #159 Conditional fields via `admin.condition` (done)
  - [x] #160 `examples/next-blog` pages built from blocks, with e2e (done)
  - [ ] Code review fixes from `main` @ 0a3d5dd, in fix order
    - [ ] Correctness: #170 (done), #171 (done), #172 (done)
    - [ ] Needed before M8: #173 (done), #176 (done)
    - [x] Conditional fields: #174 (done), #175 (done)
    - [x] Admin styling: #183 (done)
    - [ ] Minor: #177 (done), #178 (done), #179 (done), #180
- [ ] **M8: Drafts, versions & publishing** (tracking in #146; broken into issues when it starts)
- [ ] **M9: Second database adapter** (tracking in #147)
- [ ] **M10: Users, roles & field-level access** (tracking in #148)
- [ ] **M11: Localization** (tracking in #149)
- [ ] **M12: Admin UX & extensibility** (tracking in #150)

Update this section when a milestone or issue is done.

## Working agreement

- Before starting a milestone or any change touching more than one package, propose a plan and wait for approval.
- Run typecheck and tests before declaring a task done.
- If something in this file, `README.md`, or `docs/` is unclear or contradicts itself, ask instead of guessing.
