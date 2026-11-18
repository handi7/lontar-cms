# 0026: Users, roles, and auth data model

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Lontar's authentication architecture was established in [ADR 0005](0005-auth-bootstrap.md) using Better Auth for session management, credential authentication, and security controls. The database schema in `@lontar/db-mysql` and `@lontar/db-postgres` currently defines the standard Better Auth tables: `user`, `session`, `account`, and `verification`.

However, prior to Milestone 10:

- The `user` table does not store user roles.
- `AuthUser.role` in `packages/core/src/auth/types.ts` is defined as an untyped optional `role?: string` that is always `undefined` at runtime.
- The `README.md` specification has documented role-based access rules from the beginning (for example: `delete: ({ user }) => user?.role === 'admin'`).
- There is no administrative API to list, invite, update, or ban users from the admin panel.
- There is no mechanism to authenticate machine-to-machine background jobs or external services without a browser session cookie.

Milestone 10 ([#148](https://github.com/handi7/lontar-cms/issues/148)) implements users, roles, user management, and field-level access control. Before implementing the data models and APIs, we must decide:

1. Where users live (Better Auth core tables vs a dynamic Lontar collection).
2. The roles configuration format and whether users have single or multiple roles.
3. Which Better Auth plugins to adopt (`admin`) and how to structure API keys.
4. Schema changes across MySQL and PostgreSQL and migration/backfill strategy for existing installations.
5. First-user bootstrap and CLI user provisioning.
6. TypeScript typing and `generate:types` integration.
7. `ClientConfig` serialization rules for the admin SPA.
8. Disabled/banned user semantics.

---

## Decision

### 1. Where Users Live: Better Auth Tables with Dedicated Management Endpoints

We considered two architectural approaches:

- **Option A (Accepted): Keep users in Better Auth's dedicated tables (`user`, `session`, `account`, `verification`) and provide dedicated management endpoints.**
  Better Auth remains the authoritative owner of authentication tables and credentials. Lontar extends the `user` table with administrative columns (`role`, `banned`, etc.) and provides a dedicated management API (`/api/_lontar/users/*`) and admin interface.
- **Option B (Rejected for M10): Expose users as a full Lontar collection (`auth: true`, similar to Payload CMS).**
  In Option B, users would be defined as a standard collection with dynamic fields, versions, draft status, and collection hooks.
  - _Why rejected:_ Exposing users as an arbitrary collection introduces severe circular dependencies during request lifecycle handling. When verifying a session token to evaluate collection access, the engine would need to query the user collection, running user `afterRead` hooks and access rules before the current user context is even established. Additionally, reconciling Better Auth's strict schema requirements (password hashing, OAuth accounts, verification tokens) with Lontar's dynamic Drizzle migrations, version snapshots, and draft states would introduce significant operational fragility.
  - _Future cost:_ If custom user profile attributes (such as avatar uploads or author biographies) are required in future milestones (M12+), Lontar can support a configurable profile schema mapped to columns on the `user` table or a separate `profiles` collection linked via a 1:1 relationship, preserving the integrity of Better Auth's authentication core.

### 2. Roles Configuration: Single Role per User

#### Config Shape

Roles are declared in `defineConfig` under the `auth` key:

```ts
import { defineConfig } from '@lontar/core'

export default defineConfig({
  auth: {
    roles: ['admin', 'editor', 'author'] as const,
    defaultRole: 'editor',
    adminRole: 'admin',
  },
  // ...
})
```

- `roles`: An array of permitted role identifiers (strings). If omitted, defaults to `['admin', 'editor']`.
- `defaultRole`: The role assigned to newly invited or created users when no role is explicitly provided. Defaults to `'editor'`. Must be an element of `roles`.
- `adminRole`: The privileged role that possesses user management capabilities and full administrative access. Defaults to `'admin'`. Must be an element of `roles`.

#### Single Role per User

Each user has exactly one active role stored in `user.role` (e.g., `'admin' | 'editor'`).

- _Rationale:_ Single roles represent over 95% of CMS usage models and align with Better Auth's standard admin role schema. A single role keeps access control checks concise and performant:
  ```ts
  access: {
    delete: ({ user }) => user?.role === 'admin',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
  }
  ```
  Multiple roles introduce ambiguous priority ordering, complex indexing, and higher cognitive overhead when evaluating hierarchical permissions.

#### User Management Authorization

The user management API (`/api/_lontar/users/*`) and the corresponding admin UI screens are strictly restricted to users whose `role` equals `config.auth.adminRole` (by default, `'admin'`). Non-admin users cannot list other users, invite users, update user roles, or ban accounts.

### 3. Better Auth Admin Plugin and Lontar API Key Subsystem

We adopt Better Auth's official `admin` plugin for user and role management, while implementing a dedicated, lightweight API key subsystem tailored for Lontar CMS REST API access:

1. **Better Auth `admin` plugin (`better-auth/plugins/admin`):**
   - Provides battle-tested server primitives for role management, session revocation, user banning/unbanning, and credential management.
   - Extends the `user` table with:
     - `role`: `varchar(50)` (MySQL) / `text` (Postgres), `NOT NULL`, default `'editor'`.
     - `banned`: `boolean`, `NOT NULL`, default `false`.
     - `banReason`: `text`, nullable.
     - `banExpires`: `timestamp`, nullable.
2. **Lontar API Key Subsystem (`packages/core/src/auth/api-key.ts`):**
   - Implemented in [#345](https://github.com/handi7/lontar-cms/issues/345) for machine-to-machine REST API access.
   - Instead of adopting `better-auth/plugins/api-key` directly, Lontar implements its own API key subsystem using an internal Better Auth plugin schema (`apiKeyPlugin()`).
   - _Rationale:_
     - **Direct Hono Pipeline Integration:** Seamless verification in Hono middleware for both `Authorization: Bearer lt_<hash>` and `x-api-key: <token>` headers without relying on Better Auth's client-side request wrappers or RPC conventions.
     - **Secure Token Lifecycle:** Generates cryptographically secure `lt_<64-hex>` tokens, storing only one-way SHA-256 hashes (`key`) in the database while persisting a plaintext preview prefix (`start`) for user identification in the UI.
     - **Role & Ban Inheritance:** API keys automatically inherit the owning user's current role and are immediately rejected if the owning user is banned (`banned: true`) or deleted, guaranteeing zero-latency revocation.
     - **CMS-Tailored Admin UI & Endpoints:** Provides dedicated REST endpoints (`GET/POST/DELETE /api/_lontar/api-keys`) and an integrated `ApiKeysCard` on the Account page in `@lontar/admin`.

### 4. Schema and Upgrade Path

#### Table Definitions

The `user` table definition in `@lontar/db-mysql/src/schema/auth.ts` and `@lontar/db-postgres/src/schema/auth.ts` is updated to include the role and ban fields:

- **MySQL (`@lontar/db-mysql`)**:

  ```ts
  export const user = mysqlTable(
    'user',
    {
      id: varchar('id', { length: 36 }).primaryKey(),
      name: varchar('name', { length: 255 }).notNull(),
      email: varchar('email', { length: 255 }).notNull().unique(),
      emailVerified: boolean('email_verified').default(false).notNull(),
      image: text('image'),
      role: varchar('role', { length: 50 }).default('editor').notNull(),
      banned: boolean('banned').default(false).notNull(),
      banReason: text('ban_reason'),
      banExpires: timestamp('ban_expires'),
      createdAt: timestamp('created_at').defaultNow().notNull(),
      updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
    },
    (table) => [index('user_role_idx').on(table.role)],
  )
  ```

- **PostgreSQL (`@lontar/db-postgres`)**:
  ```ts
  export const user = pgTable(
    'user',
    {
      id: text('id').primaryKey(),
      name: text('name').notNull(),
      email: text('email').notNull().unique(),
      emailVerified: boolean('email_verified').default(false).notNull(),
      image: text('image'),
      role: text('role').default('editor').notNull(),
      banned: boolean('banned').default(false).notNull(),
      banReason: text('ban_reason'),
      banExpires: timestamp('ban_expires', { precision: 3, withTimezone: true, mode: 'date' }),
      createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
        .defaultNow()
        .notNull(),
    },
    (table) => [index('user_role_idx').on(table.role)],
  )
  ```

#### Migration and Backfill for Existing Projects (v0.5 -> v0.6)

Running `lontar migrate:create` generates an `ALTER TABLE user ADD COLUMN ...` migration.
During migration execution:

1. `banned` defaults to `false`.
2. For existing user records:
   - The earliest created user (`ORDER BY created_at ASC LIMIT 1`) is updated to have `role = 'admin'`.
   - All subsequent existing users are backfilled with `role = config.auth.defaultRole` (e.g., `'editor'`).
3. This guarantees that existing administrative accounts retain access to the system without manual SQL interventions.

### 5. Bootstrap and CLI Provisioning

1. **First-User Bootstrap (`POST /api/_lontar/first-user`, ADR 0005):**
   - When total user count is 0, the first-user endpoint provisions the initial user and explicitly sets `role = config.auth.adminRole` (`'admin'`).
2. **CLI User Creation (`lontar create-user`):**
   - The CLI command gains an optional `--role <role>` flag:
     ```bash
     pnpm lontar create-user --email admin@example.com --password secret --name "Admin" --role admin
     ```
   - If `--role` is omitted:
     - Defaults to `adminRole` (`'admin'`) if no users exist in the database.
     - Defaults to `defaultRole` (`'editor'`) if other users already exist.
   - If a config file is detected, the CLI validates that `--role` matches one of the declared `config.auth.roles`.

### 6. TypeScript Type Safety and Typegen

In `packages/core/src/auth/types.ts`:

```ts
export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
  banned?: boolean
  banReason?: string | null
  banExpires?: Date | null
  image?: string | null
  emailVerified: boolean
  createdAt: Date
  updatedAt: Date
  [key: string]: unknown
}
```

When running `lontar generate:types` ([#28](https://github.com/handi7/lontar-cms/issues/28)):

- The CLI inspects `config.auth.roles` (for example, `['admin', 'editor', 'author']`).
- It generates a strong union type:
  ```ts
  export type UserRole = 'admin' | 'editor' | 'author'
  ```
- It declares ambient module augmentation for `@lontar/core`:
  ```ts
  declare module '@lontar/core' {
    interface AuthUser {
      role: UserRole
    }
  }
  ```
- Any typo in access control logic (e.g., `user?.role === 'admn'`) produces an immediate TypeScript compile error.

### 7. ClientConfig Serialization (Architecture Rules 1 & 2)

Per Architecture Rule 1 and Rule 2:

- `defineConfig()` remains strictly server-only.
- The admin SPA receives a JSON-serialized `ClientConfig` via `GET /api/_lontar/config`.
- `toClientConfig()` includes:
  ```ts
  auth: {
    roles: ['admin', 'editor', 'author'],
    defaultRole: 'editor',
  }
  ```
- The admin SPA uses this metadata to render role selection dropdowns in user creation and editing dialogs.
- Access permissions (which views and fields the user may see) are resolved dynamically through the permissions API (`GET /api/_lontar/permissions`, [ADR 0027](0027-field-level-access.md)) rather than sending functions to the browser.

### 8. Disabled / Banned User Semantics

When an administrator bans or disables a user:

1. `user.banned` is set to `true` (with optional `banReason` and `banExpires`).
2. **Immediate Session Invalidation:** All active sessions belonging to the user are immediately deleted from the `session` table (`DELETE FROM session WHERE user_id = ?`).
3. **Sign-In Blocked:** Subsequent credential or OAuth login attempts via Better Auth are rejected with `403 Forbidden` ("Account is suspended").
4. **Middleware Enforcement:** Lontar's session verification middleware (`router.use('*')`) checks the user's status. If a user record is flagged as banned or expired, the session is invalidated, `c.set('user', null)`, and authenticated requests are rejected with `401 Unauthorized` / `403 Forbidden`.
5. **API Keys Disabled:** Any API keys owned by a banned user are treated as disabled and rejected by the API key middleware.

---

## Consequences

### Positive

- **Complete Role Alignment:** Resolves the discrepancy where `README.md` relied on `user?.role === 'admin'` without DB backing.
- **Battle-Tested Security:** Leveraging Better Auth's official `admin` plugin alongside Lontar's SHA-256 hashed API key subsystem prevents reinventing session revocation, password resets, and token hashing.
- **Zero-Downtime Upgrade:** Existing projects upgrading from v0.5 automatically backfill the initial user to `'admin'` and subsequent users to `'editor'`.
- **End-to-End Type Safety:** `generate:types` ensures compile-time detection of role name typos in access rules and frontend components.

### Negative / Tradeoffs

- **Fixed User Schema:** Users cannot be given arbitrary dynamic CMS fields via `defineConfig.collections` in M10. If custom fields are required later, they will need explicit extension points or a linked profile collection.
- **Single Role Constraint:** Users cannot hold multiple concurrent roles (e.g., cannot be both `'editor'` and `'billing'`). This is deemed acceptable and optimal for headless CMS requirements.
- **Reserved Slugs:** `apikey` and `rateLimit` (along with slugs `rate-limit` and `ratelimit`) are reserved by `defineConfig` to avoid collisions with the auth API key and rate limiting tables and generated schema identifiers (#375).

---

## Implementation Plan

1. **#336 (This issue):** Record ADR 0026, propose README updates, update `docs/scope.md`.
2. **#338:** Add role and ban fields to MySQL and PostgreSQL auth schemas, update Better Auth configuration with admin plugin, implement migration and backfill.
3. **#342:** Implement user management REST API (`/api/_lontar/users`) with role assignment and ban controls.
4. **#343:** Implement admin users list, user creation/editing modal, and personal account screen.
5. **#344:** Email delivery integration for password resets and user invitation emails.
6. **#345:** Machine-to-machine API keys using Lontar API key subsystem with SHA-256 hashed storage.
7. **#346:** Rate limiting for auth routes and multi-instance storage support.
8. **#347:** Integrate roles and access control into `examples/next-blog` with end-to-end tests.
