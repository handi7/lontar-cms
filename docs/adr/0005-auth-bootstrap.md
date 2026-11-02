# 0005: Auth bootstrap and sign-up restrictions

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Lontar uses Better Auth for user authentication and session management. By default, Better Auth's `emailAndPassword` provider allows anonymous self-registration via `POST /api/auth/sign-up/email`.

In a headless CMS where the admin panel is designed for content editors, public self-registration compromises security:

- Collection and global access rules commonly check `({ user }) => Boolean(user)` for write access. Open sign-up turns "authenticated users only" into "anyone on the internet".
- In production, localhost trusted origins were unconditionally enabled, which could allow unintended local origins to send requests.

## Decision

1. **Disable public self-registration by default**: Set Better Auth's `emailAndPassword.disableSignUp: true`. Anonymous callers cannot create accounts through the public auth endpoints.
2. **First-user onboarding**: Provide `GET /api/_lontar/first-user` and `POST /api/_lontar/first-user`.
   - Creation is only permitted when total users in the database equals zero (`countTotalUsers === 0`).
   - Upon creating the first user, an authenticated session is established immediately.
   - Once at least one user exists, any further calls to this endpoint are rejected with `403 Forbidden`.
3. **CLI user management**: Provide `lontar create-user --email <email> --password <password> --name <name>` in `@lontar/cli` so operators can provision users directly from the terminal.
4. **Environment-aware trusted origins**: Only include localhost origins (`http://localhost:3000`, `http://127.0.0.1:3000`) when `NODE_ENV !== 'production'`.

## Consequences

- **Secure by default**: The admin panel cannot be accessed or written to by anonymous visitors self-registering.
- **Straightforward bootstrap**: Greenfield installations can still create the initial administrator seamlessly via the first-user API or CLI.
- **Administrative control**: Subsequent users are added intentionally by operators or administrators rather than through open public sign-up.
