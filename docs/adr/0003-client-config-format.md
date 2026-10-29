# 0003: ClientConfig is plain JSON, with fields serialized as an ordered array

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The admin is a client-side SPA that never imports the config ([0001](0001-spa-admin.md)). It learns what to render by fetching a serialized `ClientConfig` from `GET /api/_lontar/config`. That payload is the entire contract between server and admin, so its shape decides what the admin can ever do.

Two questions had to be settled.

**What may cross the boundary.** `defineConfig()` holds hooks, access-control functions, the database adapter, and `process.env.LONTAR_SECRET`. None of it can reach the browser — not merely because functions do not survive `JSON.stringify`, but because some of it is credentials.

**How fields are represented.** `docs/scope.md` left this open: an object (`fields: { title: ... }`) is easier for TypeScript inference, while an array makes ordering and admin layout easier. The README already commits to an object for authoring, but authoring shape and wire shape need not match.

## Decision

`ClientConfig` is **plain JSON**: no functions, no class instances, no environment values. It must survive `JSON.parse(JSON.stringify(x))` unchanged, and a test asserts exactly that.

Fields are authored as an **object** and serialized as an **ordered array**:

```ts
// Authoring — object, for type inference
fields: { title: f.text({ required: true }), views: f.number() }

// ClientConfig — array, for explicit order
fields: [
  { name: 'title', type: 'text', required: true },
  { name: 'views', type: 'number' },
]
```

Validation has one source. Field definitions compile to Zod on the server; the admin rebuilds the same Zod schemas from `ClientField` using a shared pure function, exported from a client-safe subpath:

```ts
import { clientFieldToZod, type ClientConfig } from '@lontar/core/client'
```

That subpath contains only types and pure functions over `ClientField` — no `defineConfig`, no database, no Hono. The admin importing it is not the admin importing the config.

Field definitions themselves are plain data objects (`{ type: 'text', required: true }`). Conversion functions — to Zod, to a database column, to a client field — live in registries keyed by `type`, not attached to the field object, so field definitions stay serializable by construction.

## Alternatives considered

- **Fields as an array when authoring too, as Payload does.** Ordering comes free, but inferring a document type from an array of field definitions is markedly harder than from an object, and end-to-end type safety is a stated design principle. Rejected.
- **Object on the wire as well.** Simpler to produce, and JSON preserves string-key insertion order in practice. Rejected: order would be an implicit property of key insertion rather than data, which is fragile once configs are merged, extended, or round-tripped through tools that do not promise it.
- **Serializing functions as strings and evaluating them in the admin.** Would let access control and hooks run client-side. Rejected outright: it ships server logic and anything it closes over to the browser, and `eval` of config is an attack surface.
- **Having the admin request a fresh schema per form from the server.** Avoids duplicating validation logic, but costs a round trip per form and leaves the admin unable to validate offline or optimistically.

## Consequences

**Easier.** The admin can be developed, tested, and cached against a static JSON fixture, with no server running. Validation rules cannot drift between server and admin, because there is one function producing both. Field order is explicit data, so admin layout follows the config without a separate ordering mechanism.

**Harder.** Every new field type must serialize, which is why the per-field-type checklist in `AGENTS.md` includes `ClientConfig` serialization and a `toClientConfig()` test. Field options that are naturally functions — conditional display, custom validators, dynamic `defaultValue` — have no direct representation and will need either a declarative encoding or a server round trip. That design work is deferred, not solved here.

The `@lontar/core/client` subpath also has to stay genuinely free of server imports. A stray import of `defineConfig` would pull the database adapter into the admin bundle, so this is worth enforcing with a build-time check rather than discipline alone.

**To revisit.** Conditional fields are scheduled for v0.2 and are the first feature that will press on this format. If their arrival requires serializing behaviour rather than description, the boundary drawn here needs revisiting rather than widening.
