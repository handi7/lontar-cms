# 0018: License the project under MIT

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

`docs/scope.md` left "MIT or Apache-2.0?" as an open question, and v0.1.0 was tagged with no license at all: no `LICENSE` file and no `license` field in any `package.json` (#89). Without a license the code is "all rights reserved", so nobody may legally use the packages once they are on npm.

Lontar is embedded in the user's own application: the engine is mounted inside their Next.js or Node app and the admin is bundled into their frontend. Whatever license we pick travels with their app.

## Decision

The repository and every published `@lontar/*` package are licensed under MIT, copyright "Handiani and Lontar contributors".

- The root `LICENSE` holds the text, and each `packages/*` directory has its own copy, because npm only packs a `LICENSE` from the package directory, not from the monorepo root.
- Every `package.json` (root included) declares `"license": "MIT"`.

## Alternatives considered

- **Apache-2.0:** adds an explicit patent grant and a patent-retaliation clause, which matters most for large corporate contributors or a foundation home. It also brings NOTICE-file and change-marking obligations. That's more process than a v0.1 project needs, and it can still be adopted for future contributions if needed.
- **Copyleft (GPL/AGPL):** because Lontar ships inside the user's app, copyleft terms would reach that app. That would rule out most commercial adoption.
- **Source-available (BSL and similar):** protects a future hosted offering, but it is not open source and works against "open source, TypeScript-first headless CMS".

## Consequences

- Matches the licenses of Payload, Strapi, Hono, Better Auth and Tiptap, so adopting Lontar adds no new license review. Apache-2.0 dependencies (Drizzle, Sharp) are compatible.
- New packages must include a copy of `LICENSE` and the `license` field, or `pnpm pack` will ship them unlicensed.
- If commercial features are added later, they go in separately licensed packages. The MIT core stays MIT.
