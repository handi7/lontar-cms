# 0006: Default access control for collections and globals

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

In Lontar, collections and globals can define an optional `access` block specifying functions for `read`, `create`, `update`, and `delete`.

Previously, `checkAccess()` defaulted to returning `true` whenever an access function was not explicitly provided (`if (!fn) return true`). Under this policy:

- Collections or globals without an `access` block were completely public and writable by anonymous callers.
- Forgetting to configure `access` on a sensitive collection silently exposed a public, writable REST API.
- Relationship population allowed anonymous callers to traverse and fetch linked documents from target collections even if those collections had not defined access control.

In a headless CMS, content management and database modifications should be secure by default.

## Decision

1. **Default to requiring authentication**: When an access function is omitted for any collection or global operation, Lontar defaults the permission check to `({ user }) => Boolean(user)`.
   - Anonymous callers (`user === null`) receive `401 Unauthorized`.
   - Logged-in callers (`Boolean(user) === true`) are permitted.
2. **Explicit opt-in for public access**: To allow anonymous access (e.g. public blog post reads), developers explicitly define the rule, such as `access: { read: () => true }`.
3. **Centralized access resolution**: Deduplicate the access checking logic into `@lontar/core` (`packages/core/src/access/index.ts`) so that collections, globals, and relationship population share identical, consistent behavior.

## Consequences

- **Secure by default**: Omission of an `access` definition never accidentally opens up data modification or unauthorized reading to the public internet.
- **Predictable permissions**: Access behaves uniformly across collections, globals, and populated relations.
- **Minimal friction**: Public read access remains concise and explicit (`read: () => true`), exactly matching the patterns demonstrated in the documentation.
