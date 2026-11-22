# 0029: Admin extensibility — custom endpoints, a client component registry, and declarative actions

- **Status:** Accepted
- **Date:** 2026-11-19
- **Accepted:** 2026-11-22 ([#459](https://github.com/handi7/lontar-cms/issues/459))

## Context

Real projects outgrow generated CRUD. Editors ask for a star-rating input instead of a number box, a
dashboard tile with a count of posts awaiting approval, an "Approve" button on a row, or a screen that calls a
third-party API with a secret key. M12 ([#150](https://github.com/handi7/lontar-cms/issues/150))
lists an ADR for custom admin components, and [`docs/scope.md`](../scope.md) leaves the question
open: _a client-side registry, or import paths resolved at build time?_

Payload v3 answers this with React Server Components: a config entry points at a module path, an
import map is generated at build time, and server components read the database directly. Lontar has
ruled out every part of that:

- The admin is a **prebuilt client-side SPA** that runs wherever a `<div>` can ([0001](0001-spa-admin.md)).
  It cannot be rebuilt by the host, so it cannot learn about host modules at build time.
- `ClientConfig` is **plain JSON** ([0003](0003-client-config-format.md)). Functions are never
  serialized and never `eval`ed. Behaviour reaches the admin either as a declarative description
  (the precedent is `admin.condition`, [0022](0022-conditional-fields.md)) or through a server round trip.
- `defineConfig()` is server-only, so it is the right home for anything that holds a secret.

Today there is no supported extension point on either side:

- `<Admin>` takes only `apiBase`, `basePath` and `history` (`packages/admin/src/Admin.tsx`).
  `FieldRenderer` dispatches on a closed `switch (field.type)`, and the router's tree is fixed.
- `createLontar()` registers built-in routes only. A route added to the returned Hono app does pass
  through the session and API key middleware, because that middleware is registered on `<basePath>/*`.
  But collection routes such as `GET /:collection` and `GET /:collection/:id` are registered first,
  so `GET /api/stats` is answered by the collection handler with a 404. Projects work around this by
  writing routes outside Lontar (`examples/next-blog/app/api/revalidate/route.ts`), which then have
  no access to Lontar's session, access control or rate limiting.

This ADR covers four things that need the same plumbing: custom field inputs, custom views and
dashboard widgets, row/bulk/document actions, and server endpoints for anything beyond CRUD.

## Decision

Server code and client code stay on their own sides. They meet only through **string keys and
declarative descriptors** carried in `ClientConfig`.

| Concern               | Lives in                        | Crosses the boundary as      |
| --------------------- | ------------------------------- | ---------------------------- |
| Server logic, secrets | `endpoints` in `defineConfig()` | nothing (called over HTTP)   |
| React components      | `<Admin components={...} />`    | a string key in the config   |
| Actions               | `admin.actions` descriptors     | JSON: label, endpoint, scope |

### 1. Custom endpoints (server)

Endpoints are declared in config, at the root, on a collection, or on a global:

```ts
export default defineConfig({
  endpoints: [
    {
      name: 'pendingStats',
      method: 'get',
      path: '/stats/pending',
      access: ({ user }) => user?.role === 'admin',
      handler: async (c, { lontar }) => {
        const { totalDocs } = await lontar.find('posts', {
          where: { approved: { equals: false } },
          limit: 1,
        })
        return c.json({ pending: totalDocs })
      },
    },
  ],
  collections: [
    collection({
      slug: 'posts',
      endpoints: [
        {
          name: 'approve',
          method: 'post',
          path: '/:id/approve',
          access: ({ user }) => user?.role === 'editor' || user?.role === 'admin',
          handler: async (c, { lontar, id }) =>
            c.json(await lontar.update('posts', id, { approved: true })),
        },
      ],
      fields: {/* ... */},
    }),
  ],
})
```

**Mount points.** Root endpoints mount at `<basePath><path>`, collection endpoints at
`<basePath>/<slug><path>`, and global endpoints at `<basePath>/globals/<slug><path>`.

**Ordering.** `createLontar()` registers endpoints after the session and API key middleware and
**before** the built-in collection and global routes, so a custom path is never shadowed.

**Reserved paths.** Because custom endpoints win, the config validator rejects any path that could
overlap a built-in route, and fails at startup with a message naming the conflict:

- Root: the first segment must not be a collection slug or `auth`, `globals`, `_lontar`.
- Collection: the path must start with a static, non-numeric segment other than `file` (document IDs
  are positive integers, so this never matches `/:collection/:id`), or with `/:id/` followed by a
  static segment other than `versions`, `publish`, `unpublish`.
- Global: the first segment must not be `versions`, `publish`, `unpublish`.

A test asserts that the reserved lists cover every route the built-in `register*Routes` functions
register, so a new built-in route cannot silently collide.

**Handler context.** The handler receives the Hono context and a second argument:

```ts
interface EndpointContext {
  user: AuthUser | null
  apiKey: ApiKeyItem | null
  id?: number // parsed from :id, 400 if invalid
  locale?: string // from ?locale, as REST does (ADR 0028)
  config: Config
  lontar: LontarClient // see below
}
```

`lontar` is the Local API **bound to the caller**: `overrideAccess: false` and `user` are preset, and
a handler that genuinely needs elevated access passes `overrideAccess: true` explicitly. This is the
opposite of `getLontar()`'s default, on purpose: `getLontar()` serves trusted server code, while an
endpoint is reachable from any browser.

**Access.** `access` uses the existing `AccessFunction` signature (`{ user, id, req, locale }`).
No user and a failing check return `401`; a user and a failing check return `403`. Omitting `access`
means "any authenticated user", not "public"; a public endpoint states `access: () => true`.

**API keys.** Endpoints are session-only unless they set `apiKey: true`, matching the rule that
interactive routes reject API keys (README, _API keys_). An API key request to a session-only
endpoint returns `403`.

**Rate limiting.** An endpoint may set `rateLimit: { window, max }`, enforced by the existing
`RateLimiter` and keyed by client IP and endpoint name. There is no default limit.

Endpoints never appear in `ClientConfig` except by `name`, where an action references one.

### 2. Client component registry (admin)

The host registers components on `<Admin>`, and the config refers to them by key:

```tsx
// app/admin/[[...slug]]/page.tsx — client component in the host app
<Admin
  components={{
    'rating-stars': RatingStars,
    'pending-widget': PendingWidget,
    'seo-audit': SeoAuditView,
  }}
/>
```

```ts
// lontar.config.ts — strings only, so ClientConfig stays JSON
rating: f.number({ admin: { component: 'rating-stars' } })

admin: {
  dashboard: { widgets: [{ component: 'pending-widget', width: 'half' }] },
  views: [{ key: 'seo-audit', label: 'SEO audit', component: 'seo-audit', access: ({ user }) => !!user }],
}
```

Three slots, each with a published props interface exported from `@lontar/admin`:

- **Field input** (`admin.component` on any field): replaces the input only. Label, description,
  conditional display, field-level access locks and the value's validation stay Lontar's.
  The value is still validated by the field type's Zod schema ([rule 5](../../AGENTS.md)), so a custom
  component cannot change what is stored. Props: `CustomFieldProps` (`value`, `onChange`, `onBlur`,
  `path`, `field`, `readOnly`, `locale`, `error`). New field _types_ with their own storage are out
  of scope.
- **Dashboard widget** (`admin.dashboard.widgets`): rendered by `DashboardView` in config order.
  Props: `DashboardWidgetProps`.
- **Custom view** (`admin.views`): a route at `<adminBasePath>/views/<key>` with an entry in the
  sidebar. Props: `CustomViewProps`. Its server-side `access` function is evaluated by the permissions
  endpoint ([0027](0027-field-level-access.md)) and only the boolean reaches the admin. Hiding a view
  is cosmetic; the endpoints the view calls enforce access.

Supporting rules:

- **Hooks, not internals.** Components get data through exported hooks: `useAdminConfig()`,
  `useAuth()` (already exported), `useLontarFetch()` (fetch bound to `apiBase` with credentials), and
  `useDocumentForm()` for field components that read sibling values. Anything not exported is private
  and may change in a minor release.
- **Shared React.** `react` and `react-dom` are already peer dependencies and external in the admin
  build, so host components share the admin's React instance and hooks work across the boundary.
- **Unknown keys fail visibly, not fatally.** The server cannot see the registry, so a missing key is
  found in the browser. The admin renders a placeholder naming the key and logs a warning; the rest of
  the admin keeps working.
- **Typed keys.** `@lontar/core` exposes an empty `AdminComponentKeys` interface that projects augment
  by declaration merging, following `UserRoleExtension`. Untyped projects accept any string.
- **Styling.** Host components bring their own styles and are responsible for scoping them. The
  `--lontar-*` tokens ([0020](0020-admin-dark-mode.md)) are the supported way to match the theme; the
  admin's `lt:` utilities are not a public API.

A collection slug `views` is rejected when `admin.views` is non-empty, since `/views/$key` would
shadow that collection's edit route.

### 3. Declarative actions

An action is a JSON descriptor that binds a button to an endpoint. Most actions need no client code:

```ts
admin: {
  actions: [
    { key: 'approve', label: 'Approve', endpoint: 'approve', scope: ['row', 'document'] },
    { key: 'archive', label: 'Archive', endpoint: 'archiveMany', scope: ['bulk'], confirm: 'Archive {count} posts?', variant: 'destructive' },
  ],
}
```

- `scope: 'row' | 'document'` calls the endpoint with `:id` filled in. `scope: 'bulk'` sends
  `POST` with `{ ids: number[] }` to an endpoint without `:id`.
- After success the admin invalidates the collection's queries and shows a toast; a non-2xx response
  shows the endpoint's `error` message.
- An action is shown when its endpoint's `access` passes for the current user with `{ user }` only,
  reported by the permissions endpoint. The endpoint still re-checks with `id` on every call.
- An action may set `component` instead of `endpoint` to open a registered component in a dialog,
  for flows that need input before calling the server.
- `toClientConfig()` validates that each `endpoint` names an endpoint on the same collection or
  global, and fails at startup if not.

Bulk actions depend on list-view row selection, planned in #150.

### Settled points

Accepting this ADR fixes the following, which the implementation issues rely on:

- **Reserved paths.** The lists in section 1 are the rule. The config validator fails at startup, and
  the coverage test keeps the lists in step with the built-in routes.
- **Local API.** `lontar` in an endpoint handler is bound to the caller with `overrideAccess: false`.
  Elevated access is an explicit opt-in per call.
- **Session-only by default.** An endpoint rejects API keys with `403` unless it sets `apiKey: true`.
- **Default access.** Omitting `access` means any authenticated user. A public endpoint writes
  `access: () => true`.

### Rollout

1. Custom endpoints ([#464](https://github.com/handi7/lontar-cms/issues/464)), and field components
   through the registry ([#465](https://github.com/handi7/lontar-cms/issues/465)).
2. Dashboard widgets ([#466](https://github.com/handi7/lontar-cms/issues/466)) and custom views
   ([#467](https://github.com/handi7/lontar-cms/issues/467)), after #465.
3. Row and document actions ([#468](https://github.com/handi7/lontar-cms/issues/468)), after #464, then
   bulk actions ([#469](https://github.com/handi7/lontar-cms/issues/469)), after list-view row
   selection ([#460](https://github.com/handi7/lontar-cms/issues/460)), #464 and #468.

A widget that needs server data also needs #464. An action's `component` dialog needs #465.

Each phase updates `README.md` (the public API spec) in the same PR, and adds `toClientConfig()`
tests for every new admin option per the `AGENTS.md` checklist.

## Alternatives considered

- **Import paths resolved at build time (Payload's import map).** The config names a module path and
  a build step generates an import map. Rejected: it requires the host to bundle the admin, which
  ends the prebuilt SPA of [0001](0001-spa-admin.md) and needs a bundler plugin per host framework.
- **Loading components by URL at runtime (module federation or `import(url)` from `ClientConfig`).**
  Rejected for now: the server's JSON would decide which code the browser executes, which is the
  attack surface [0003](0003-client-config-format.md) refused, and it brings CSP, versioning and
  React-sharing problems with it.
- **Leaving custom routes to the returned Hono app.** Rejected: routes under `basePath` are shadowed
  by collection routes, nothing documents the ordering, and handlers rebuild access checks by hand.
- **Endpoints as a `createLontar()` option instead of config.** Rejected: collection-scoped endpoints
  and actions belong next to the collection, and actions are validated against them in
  `toClientConfig()`, which only sees the config.
- **Actions as client components only.** Rejected as the default: a button that calls the server
  should not need host code. The `component` escape hatch covers the rest.
- **A public plugin system.** Out of scope; it remains a non-goal in [`docs/scope.md`](../scope.md).
  The registry and `endpoints` are per-project extension points, not a packaging format.

## Consequences

**Easier.** Server-side work that needs secrets or cross-collection queries gets one supported
place, with session, access, API key policy and rate limits inherited. Common admin customizations
need no fork. `ClientConfig` stays plain JSON and the admin stays prebuilt.

**Harder.**

- The props interfaces and exported hooks become public API under semver. Keep the exported surface
  small and grow it on request.
- The reserved-path lists must track the built-in routes; the coverage test is what keeps this honest.
- A config referencing an unregistered component is only caught in the browser.
- Custom endpoints get exactly the request protection the built-in routes get. Today that is the
  session cookie's `SameSite` policy and JSON bodies; Better Auth's `trustedOrigins` check covers only
  `/auth/*`. If Lontar adds an origin check for mutating routes, it must cover custom endpoints too.
- Custom views add `views` as a conditionally reserved collection slug.

**To revisit.**

- If projects keep registering components to express what is really data (a select with a remote
  options source, say), that is the signal from [0001](0001-spa-admin.md) to add a declarative option
  instead.
- Custom list cells, edit-view sidebar panels and custom field types with their own storage are
  natural next slots, deliberately left out of this decision.
- Dynamic `where` from access functions, deferred to M12 by [0027](0027-field-level-access.md), may
  change how `lontar` scopes reads inside endpoints.
