# 0030: Row-level access — constraints returned from collection access functions

- **Status:** Accepted
- **Date:** 2026-11-22
- **Accepted:** 2026-11-22 ([#470](https://github.com/handi7/lontar-cms/issues/470))

## Context

[ADR 0027](0027-field-level-access.md) §8 deferred this to M12 ([#470](https://github.com/handi7/lontar-cms/issues/470)): an
access function that returns a `where` expression instead of a boolean, so that one rule can say "an author reads and edits
their own posts":

```ts
access: {
  read: ({ user }) => (user?.role === 'editor' ? true : { author: { equals: user?.id } }),
}
```

Today an access function returns `boolean | Promise<boolean>` and `checkAccess` coerces the result with `Boolean(...)`.
A function receives `{ user, id, data, req, locale }`, but not the stored document: on `find` it has no `id`, and on a
write `data` is the incoming payload, not the row. So a rule that depends on the row can only be built from query
parameters the client sends, or from a `beforeChange` hook that runs after access. Neither protects a read, a list, a
count, a populated relation or a version history.

The places that call `checkAccess` for a collection are `find`, `findByID`, `create`, `update`, `delete`, publish and
unpublish, the version operations, relationship population, the upload file route, and the permissions endpoint. Webhooks
dispatch server-side with no user. The admin's bulk actions ([#460](https://github.com/handi7/lontar-cms/issues/460)) call
the per-document endpoints, one request per row.

The design has to keep what the earlier access ADRs settled: fail closed ([ADR 0027](0027-field-level-access.md) §7), no
oracle through queries (§4), the Local API's `overrideAccess` ([ADR 0027](0027-field-level-access.md) §9), and a
`ClientConfig` that stays plain JSON (Architecture Rule 2). An access function is server code, so none of this reaches the
admin except through the permissions endpoint.

This ADR decides the contract. It changes no code.

---

## Decision

### 1. The return type: `boolean | Where`

`read`, `update` and `delete` on a collection may return a **constraint**: a `Where` object, the same type that queries use.

| Returns                | Meaning                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `true`                 | Every document.                                                       |
| `false`                | No document. Denied, as today (`401` without a user, `403` with one). |
| a `Where` constraint   | Only documents that match it.                                         |
| a throw or a rejection | Denied. Fail closed, as today.                                        |

```ts
type AccessResult = boolean | Where
type ConstraintAccessFunction = (args: AccessArgs) => AccessResult | Promise<AccessResult>
```

- **`create` stays boolean.** There is no existing row for a constraint to select. A `create` function that returns an
  object is denied, and a warning is logged, rather than being read as truthy.
- **Globals stay boolean.** A global is one document, so a constraint on it is `true` or `false` under another name.
  Returning an object from a global's `read` or `update` is denied the same way.
- **Field-level `access` stays boolean.** A constraint selects rows, not parts of a row.
- **`Boolean(result)` goes away for the three operations that accept a constraint.** A result that is neither a boolean nor
  a plain object (for example a user object returned by mistake) is not truthy-allowed. It is invalid, and invalid
  results are denied (§3).

`AccessArgs` is unchanged. The function is still called once per operation with `{ user, id, data, req, locale }`, and
the constraint it returns is data computed for this request (it can close over `user.id`).

### 2. What a constraint can say

A constraint uses the existing query language and nothing new: field names, `and` / `or`, and the operators `equals`,
`not_equals`, `contains`, `in`, and the comparison operators. Nested paths (`seo.title`, `items.sku`), relationship ids and
`id` work as they do in a request's `where`. Both adapters already evaluate these, so **neither adapter needs a new
capability.**

A constraint is checked before it is used:

- **Structure is validated like user input.** The same `validateWhere` that checks a request runs on the constraint: the
  field must exist, nested and localized paths must resolve, and operators must fit the field type. A typo in a rule fails
  closed instead of silently matching nothing or everything.
- **Field read access is not applied to it.** The constraint is written by the developer, not supplied by the caller, so
  it may name a field the caller cannot read (`ownerId`, an internal `tenant` flag). That is not an oracle: every row the
  caller can reach already satisfies the constraint, so filtering or sorting on a readable field reveals nothing about it.
  ADR 0027 §4 still applies, unchanged, to the `where` and `sort` the _request_ sends.
- **An empty constraint is invalid.** `{}`, `{ and: [] }` and `{ or: [] }` match nothing sensibly and everything
  dangerously, so they are denied. A rule that means "everything" returns `true`.
- **Localized fields use the request locale.** A constraint on a localized field is evaluated in the operation's resolved
  locale, as a `where` is. A rule that should hold in every locale puts it on a non-localized field.

### 3. Failing closed

A constraint that does not validate, or a function that throws, is denied and logged on the server. The caller sees what a
plain `false` shows today. A database error while evaluating a constraint is **not** an allow: it surfaces as the `500` it
would be for any failed query.

### 4. Combining with the request

The constraint is combined with the request's own filter as `and`, in core, before the adapter is called:

```ts
where = requestWhere ? { and: [requestWhere, constraint] } : constraint
```

This is the same shape `find` already uses to add the published filter for a collection with drafts, and the two
compose: `{ and: [requestWhere, constraint, publishedFilter] }`. The caller cannot widen the constraint with `or` in the
request, because the constraint sits outside it.

### 5. Single-document operations: existence is a query

`findByID`, `update`, `delete`, publish and unpublish, version history and restore, and the upload file route all name one
document, and the adapter's `findByID` takes no `where`. The decision is **one helper, `findConstrained`, that reads the
row with `find`**: `where: { and: [{ id: { equals: id } }, constraint] }`, `limit: 1`. It is a query, not an in-memory
evaluation, so the constraint means the same thing here as in a list, including nested, localized and relationship paths.

- For `findByID`, the row returned by this query is the document, so there is no second read.
- For the mutations, it is one extra read before the write, inside the transaction the operation already opens.
- The upload file route (`GET /api/<collection>/file/:filename`) looks the document up by `filename` under the same
  constraint, instead of checking collection read access alone.

**The constraint is evaluated against the stored row, not the incoming data and not a draft.** Ownership should not change
because a draft was edited, and draft content is already gated by update access ([ADR 0023](0023-version-storage-and-drafts.md)
§5). An update that changes the field the constraint reads (reassigning `author`) is allowed if the _current_ row matched,
and the document leaves the caller's scope when it is saved. There is no post-write check. A rule that must stop
reassignment says so with a `beforeChange` hook or field-level `access.update`.

### 6. A document outside the constraint is `404`, not `403`

When the function returns a constraint and the row does not match, the response is **identical to a document that does not
exist**: `404` with `Document with ID <id> not found`, for `findByID`, `update`, `delete`, publish, unpublish, versions,
restore and the file route. Both paths run the same single query, so the status, the body and the work done match.

`403` stays for a function that returns `false`. That path is decided before any document is looked up, as today.

Not covered, because it predates this ADR: a function that returns `false` _because of_ `id` already tells the caller that
the row exists, since a missing id is `404`. A rule that must hide existence should return a constraint, not `false`.

### 7. Lists, counts, relationships, versions, webhooks, bulk actions

- **`find` and counts.** The constraint is part of the query, so `docs` and `totalDocs`, `totalPages` and the paging links
  all describe only the rows the caller may read. There is no separate count to leak.
- **Relationship population.** The target collection's `read` constraint is added to the fetch by ids:
  `{ and: [{ id: { in: ids } }, constraint] }`. A related document outside the constraint is not populated and the
  field keeps its bare id, which is what an unreadable collection does today. The id was already in the parent document.
  The function is evaluated once per target collection per population pass.
- **Version history.** Listing, reading and restoring versions need `read` and `update` on the parent document (ADR 0023
  §5). Both constraints are checked against the parent row with §5's helper, and a miss is `404`. A version snapshot is
  never matched on its own content.
- **Draft reads** (`draft=true`) need `update` access as today. With a constraint, the `update` constraint is applied as
  well as `read`, and the row must satisfy both.
- **Webhooks** are system events. They ignore row constraints exactly as they ignore collection `read` access today. The
  payload is still stripped by field-level access as for an anonymous caller (`sanitizeDocRead` with no user).
- **Admin bulk actions** call the per-document endpoints, so each row is checked on its own. A row outside the constraint
  reports `404` in the bulk summary, like any failed row. No server-side bulk endpoint exists or is added.

### 8. Field-level access and fail-closed rules

The two layers stack, row first. The collection-level constraint decides which rows are returned. Field-level access
([ADR 0027](0027-field-level-access.md)) then strips fields from those rows, and its query checks apply to the request's
`where` and `sort`. Neither layer weakens the other, and a failure in either is a denial.

### 9. The Local API

`overrideAccess: true` (the default) calls no access function, so no constraint is computed or applied. With
`overrideAccess: false` and a `user`, the Local API enforces constraints exactly as REST does, including `404` for a row
outside the constraint, so a server-side caller can act on behalf of a user without a separate code path.

### 10. The permissions endpoint and the admin

`GET /api/_lontar/permissions` answers for a collection, not a row, so it cannot say "all rows". The decision:

- **List level: a boolean means "at least some rows".** `read`, `update` and `delete` are `true` when the function returns
  `true` _or_ a constraint, and `false` when it returns `false` or is invalid. The admin keeps showing the navigation entry
  and the list for a collection that is only partly readable.
- **A new optional field marks the partial ones:**
  `constrained?: { read?: boolean; update?: boolean; delete?: boolean }`, present only when something is constrained. It is
  part of the permissions response, not of `ClientConfig`, so Architecture Rule 2 is untouched. It lets the admin avoid
  promising a bulk action that will partly fail.
- **Document level is exact.** `GET /api/_lontar/permissions/:collection/:id` runs §5's helper for `read`, `update` and
  `delete` and reports the result for that row. A row outside the `read` constraint is `404`, as the endpoint already does
  when read is denied.
- **The list view does not get per-row flags.** A row action the constraint forbids shows its `404` as an error and the
  list refetches. Per-row permissions in the list response are possible later and are not part of this decision.

`ClientConfig` carries no access information and does not change.

### 11. Types and typegen

`CollectionAccess` gets `read`, `update` and `delete` typed as `ConstraintAccessFunction`, and `create` stays
`AccessFunction`. `Where` is the existing loosely typed query type, so a constraint is not checked against the collection's
field names at compile time; it is checked when the function's result is validated (§2). `lontar generate:types` output is
unchanged.

---

## Consequences

### Positive

- **Ownership rules in one place.** "Authors see their own posts" is one function, enforced on lists, counts, single
  reads, writes, relations, versions and files, not re-implemented in hooks and query parameters.
- **No new capability in either adapter.** Constraints reuse `where`, which both adapters already evaluate, including
  nested, localized and relationship paths. Only the conformance suite grows.
- **No existence leak.** A document outside a constraint is indistinguishable from a missing one.
- **Backward compatible for typed code.** Functions that return booleans behave exactly as before.

### Negative / tradeoffs

- **An extra read per single-document operation.** Each `update`, `delete`, publish and version call does one more
  indexed `find`. `findByID` does not, because the constraint query returns the row.
- **Check and write are not atomic.** The constraint query is a plain read, so it takes no lock (the adapter's
  `findByID({ forUpdate })` is what locks a row for a write, and it takes no `where`). A concurrent change to the
  constrained field between the check and the write can let a write through that no longer matches. Passing the constraint to the adapter's `update` and `delete` as an extra condition would close
  it; this ADR does not require that.
- **No post-write check.** An update can move a document out of the caller's scope (§5).
- **Truthy non-boolean results are no longer allowed.** A JavaScript caller that returned an object by mistake used to be
  allowed and is now denied. TypeScript callers cannot do this today.
- **Constraints are not compile-time checked** against field names (§11).
- **List rows can offer an action that then `404`s** (§10).

## Out of scope

Constraints on `create`, on globals or on fields; per-row permission flags in list responses; atomic constraint
enforcement in the adapter's `update` and `delete`; database-level row security; evaluating constraints against draft
content.

---

## Implementation plan

Tracked in [#470](https://github.com/handi7/lontar-cms/issues/470) and [#150](https://github.com/handi7/lontar-cms/issues/150).
Each step is its own PR and carries its tests.

1. **This ADR**, and a pointer from ADR 0027 §8.
2. **Core resolver:** `AccessResult` and `ConstraintAccessFunction` types; a `resolveAccess` that returns
   `{ allowed, constraint? }` with validation and fail-closed handling; `create` and globals deny objects. `find` applies
   the constraint (§4) and `findByID` uses the constraint query (§5, §6).
3. **Core mutations and the rest:** `update`, `delete`, publish and unpublish, version operations, the file route, and
   population (§5, §7), with `findConstrained` shared between them.
4. **Permissions endpoint and admin:** list-level meaning, the `constrained` field, exact document-level answers, and the
   admin's handling of a `404` row action (§10).
5. **Conformance and access tests:** both adapters for read, update and delete (including nested, localized and
   relationship paths); access tests for population, versions, the file route, webhooks and bulk actions; the `404`
   equivalence.
6. **README:** the access function's return type, with the `read: ({ user }) => ({ author: { equals: user.id } })` example.
