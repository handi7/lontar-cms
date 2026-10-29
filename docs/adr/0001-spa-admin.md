# 0001: The admin panel is a pure client-side SPA

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Lontar takes Payload's code-first approach, so the admin panel has to be generated from the same config that drives the API. The question is what the admin is built as, and how a host application embeds it.

Payload v3 answered this with React Server Components inside the Next.js App Router. That makes the admin fast to render and lets it reach server state directly, but it also couples the CMS to one framework and one rendering model: every Next.js release becomes a CMS concern, and the admin cannot be mounted anywhere else.

Lontar's engine is a Hono app precisely so it can run in Next.js, standalone Node, or other runtimes. An admin that only works under Next.js would undo that.

## Decision

The admin is a **pure client-side SPA**, built with Vite and React, shipped as a prebuilt library.

- `packages/admin` builds to `dist/index.js` plus `dist/styles.css` and exports a single `<Admin apiBase basePath />` component.
- It contains no React Server Components, no `server-only` imports, and no framework-specific APIs.
- It never imports `lontar.config.ts` or anything the config holds. Everything it needs arrives as JSON from `GET /api/_lontar/config` (see [0003](0003-client-config-format.md)).
- All styles are scoped so they cannot leak into the host application.

A host embeds it by rendering the component and mounting the API; nothing else is required.

## Alternatives considered

- **React Server Components, as Payload v3 does.** Rejected: it ties the admin to Next.js and to the App Router's release cycle, which is the specific coupling Lontar exists to avoid.
- **Server-rendered HTML from the Hono app.** Rejected: the admin is a dense, stateful editing UI. Building it without a client framework means reimplementing form state, tables, and routing by hand, against the principle of using mature libraries rather than reinventing them.
- **A separately deployed admin application.** Rejected: it forces users to run and host a second service, when the point is to mount a CMS into an app they already have.

## Consequences

**Easier.** The admin runs anywhere a `<div>` can: Next.js, Vite, Remix, or a static page pointed at a remote API. Its release cycle is independent of any host framework. It can be developed against a dev server and a proxy, with no host app running at all.

**Harder.** Anything the UI needs must be expressible as JSON in `ClientConfig`, which constrains what field options can be. Config features that are functions — access control, hooks, custom validation — need a deliberate serialization story or a server round trip; they cannot simply be read. This is a real constraint, and [0003](0003-client-config-format.md) exists to manage it.

The admin is also a client-side bundle, so first paint waits on JavaScript and on the config fetch. For an authenticated editing tool behind a login, that trade is acceptable; it would not be for public-facing pages.

**To revisit.** If `ClientConfig` starts accumulating fields that exist only to describe behaviour the server already knows, that is a signal the boundary is in the wrong place, and the serialization format needs rethinking rather than extending.
