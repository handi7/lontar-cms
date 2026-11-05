# Releasing

Releases are published from GitHub Actions (`.github/workflows/release.yml`), not from a laptop. Pushing a `vX.Y.Z` tag runs CI, waits for approval, publishes every `@lontar/*` package to npm with provenance, and creates the GitHub Release from `CHANGELOG.md`.

## How a release runs

1. **verify**: the tag must match the version of the root `package.json` and every package in `packages/`, and `CHANGELOG.md` must have a `## [X.Y.Z]` section.
2. **ci**: the same checks as `ci.yml` (format, lint, typecheck, build, tarball smoke test, unit tests, e2e).
3. **publish** (in the `npm` environment, so it waits for a maintainer to approve it):
   - builds and packs the packages with `pnpm pack`, which rewrites `workspace:` ranges
   - smoke-tests the tarballs and publishes those exact tarballs with npm's trusted publishing (OIDC, no token)
   - creates the GitHub Release

Versions already on npm are skipped, so re-running a release that failed halfway is safe.

## Cutting a release

1. Bump `version` in the root `package.json` and in every `packages/*/package.json` to the same version.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`. It becomes the GitHub Release notes, with relative links rewritten to point at the tag.
3. Merge that to `main`.
4. Optional: run the **Release** workflow from the Actions tab (or `gh workflow run release.yml --ref main`). It does a dry run of the current version: same checks, `npm publish --dry-run`, no release.
5. Tag the merge commit and push the tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

6. Approve the `publish` job when CI is green (Actions → the run → **Review deployments**).

A version number can never be reused on npm, and unpublishing only works within 72 hours, so check the dry run before tagging. Prerelease tags (`v1.0.0-beta.1`) are rejected for now, since they would need their own npm dist-tag.

## Checking the tarballs locally

```bash
pnpm build
pnpm pack:packages /tmp/lontar-packed
pnpm smoke:packages /tmp/lontar-packed
```

The smoke test installs the tarballs with npm into a temporary project outside the workspace. It then checks that:

- every manifest has no `workspace:` ranges and ships `dist`, `LICENSE` and `README.md`
- every `exports` entry resolves, and every JavaScript entry imports
- every bin runs with `--help`
- the published types compile

Type errors inside third-party declarations (drizzle-orm, better-auth) are ignored. Only errors in `@lontar/*` declarations fail the check.

## One-time setup

- **GitHub environment `npm`**: required reviewer `handi7`, deployments only from tags matching `v*`. (Settings → Environments.)
- **npm trusted publishing**: for each package (`@lontar/core`, `admin`, `next`, `cli`, `db-mysql`, `storage-local`, `storage-s3`), on npmjs.com go to Settings → Trusted publishing → GitHub Actions and enter: owner `handi7`, repository `lontar-cms`, workflow `release.yml`, environment `npm`. A new package has to be published once by hand before it can be configured.
- Once a release has gone through the workflow, set each package's publishing access to "Require two-factor authentication and disallow tokens".
