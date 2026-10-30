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
- Admin: Vite, React, TanStack Router, TanStack Query, TanStack Table, React Hook Form, dnd-kit, Tiptap, shadcn/ui + Tailwind
- Build: tsdown/tsup for packages
- Tests: Vitest (unit/integration), Playwright (admin e2e)

## Packages

```
packages/
  core/        defineConfig, field definitions, CRUD operations, hooks, access control, Local API
  db-mysql/    Drizzle-based MySQL adapter, schema generation, migrations
  admin/       Vite + React SPA, ships prebuilt JS + scoped CSS
  next/        Next.js adapter (route handlers)
  cli/         lontar migrate, migrate:create, generate:types
examples/
  next-blog/   Example app used for manual and e2e testing
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
pnpm test         # vitest across all packages
pnpm lint         # eslint
pnpm format       # prettier --write
pnpm format:check # prettier --check
```

Packages build with tsdown, except `admin`, which is a Vite library build.
`publint` runs as part of each tsdown build, so a `package.json` whose `exports`
disagree with the build output fails the build rather than the install.

`pnpm install` sets up a Husky pre-commit hook that runs lint-staged (eslint --fix and
prettier on staged files only). CI (`.github/workflows/ci.yml`) runs
`format:check` → `lint` → `typecheck` → `build` → `test` on every PR and on pushes to `main`.

## Conventions

- Public APIs must match `README.md`. If an implementation needs a different API, propose the README change first instead of silently diverging.
- Every new field type needs: definition, Zod schema, DB column mapping, `ClientConfig` serialization, admin input component, and tests.
- Prefer small, focused PRs per milestone task.
- ESLint caps `complexity` at 10 and `sonarjs/cognitive-complexity` at 15. Split the function instead of disabling the rule; if a disable is truly needed, say why in a comment next to it.
- Record significant decisions as a new ADR in `docs/adr/NNNN-title.md` (context, decision, consequences).

## Current milestone

**M0: Repo setup + walking skeleton**

- [x] Monorepo with the packages above, shared tsconfig, lint, Vitest
- [x] CI workflow, complexity lint, pre-commit hook
- [ ] `posts` collection with `text` and `number` fields, defined via `defineConfig`
- [ ] Drizzle schema generated from config, migration runs against MySQL
- [ ] REST list/get/create/update/delete for `posts`
- [ ] `ClientConfig` endpoint
- [ ] Admin SPA renders the collection list and an edit form from `ClientConfig`
- [ ] `examples/next-blog` mounts the API and admin

Update this section when a milestone is done.

## Working agreement

- Before starting a milestone or any change touching more than one package, propose a plan and wait for approval.
- Run typecheck and tests before declaring a task done.
- If something in this file, `README.md`, or `docs/` is unclear or contradicts itself, ask instead of guessing.
