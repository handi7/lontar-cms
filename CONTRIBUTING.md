# Contributing to Lontar

Thanks for taking an interest. Lontar is early (v0.1.x), so the quickest way to get a
change merged is to check that it fits the current scope before writing code.

- [`docs/scope.md`](docs/scope.md) — what v0.1 covers, and the full list of non-goals.
- [`README.md`](README.md) — the target public API. Treat it as the spec.
- [`docs/adr/`](docs/adr/) — why things are built the way they are. Read the relevant ADR
  before changing anything it covers.
- [`AGENTS.md`](AGENTS.md) — written for AI coding agents, but its architecture rules
  apply to everyone.

## Picking something to work on

How much coordinating a change needs depends on how big it is:

| Change                                                                                      | What to do                                                |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A typo, a docs fix, or a fix confined to one file                                           | Just open a PR. No need to ask first.                     |
| An issue in the milestone currently in progress, or anything touching more than one package | Comment on the issue first and wait to be assigned.       |
| A new feature, or a change to a public API                                                  | Open an issue describing the problem before writing code. |

The second row matters because milestone issues are usually ordered. M6 (#123) is a
sequence where each step builds on the one before it, so two people working on
neighbouring issues at the same time will collide.

If an issue is assigned, it is taken. If you claimed one and your plans changed, say so on
the issue so it frees up — that is more useful than going quiet.

Labels, milestones and assignees are set by a maintainer. GitHub hides those controls from
people without write access, so there is nothing for you to fill in there.

## Setting up

Node 22.22.1 or newer. pnpm is pinned in `package.json` under `packageManager`, so
Corepack picks up the right version on its own.

```bash
pnpm install
cp .env.example .env
pnpm db:up
```

`pnpm db:up` starts MySQL from `docker-compose.yml` and waits until it is healthy;
`pnpm db:down` stops it.

Tests connect using `TEST_DATABASE_URL`, and each test file creates and drops its own
database (`lontar_test_<hex>`), so running the suite never touches the data behind
`DATABASE_URL`.

## Working on a change

Branch from `main`, named `<type>/<issue-number>-<short-slug>`:

```
fix/67-packaging-sharp-deps
docs/122-admin-theme-tokens
feat/cli-generate-types
```

`fix/`, `feat/`, `docs/`, `ci/`, `chore/`, `release/`, `perf/` and `refactor/` are the
prefixes the tooling recognises. PR labels are applied automatically from the prefix and
from the paths you touched, so an accurate prefix saves a manual correction.

A pre-commit hook runs `lint-staged` — `eslint --fix` and Prettier on staged files only.
It covers formatting, not the rest.

ESLint caps cyclomatic `complexity` at 10 and `sonarjs/cognitive-complexity` at 15. Split
the function rather than disabling the rule; if a disable is genuinely needed, say why in
a comment next to it.

Some changes have a fixed shape:

- **A new field type** needs all of: definition, Zod schema, DB column mapping,
  `ClientConfig` serialization, admin input component, and tests.
- **A significant decision** needs an ADR in `docs/adr/NNNN-title.md` — context, decision,
  consequences. Copy [`docs/adr/0000-template.md`](docs/adr/0000-template.md).
- **A public API that has to differ from `README.md`** needs the README change proposed
  first, rather than the code quietly diverging from it.

## Before you open a PR

Run what CI runs, in the same order:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

CI also runs the admin end-to-end suite. If you touched the admin, run it locally too —
it needs Playwright's Chromium once:

```bash
pnpm --filter next-blog exec playwright install chromium
pnpm test:e2e
```

## Opening the PR

- Title in conventional-commit form, matching what lands on `main`: `docs: ...`,
  `fix(core): ...`, `feat(admin): ...`.
- Put `Closes #NNN` in the body so the issue closes on merge.
- Say what you verified and what you did not. A PR that names the tests it ran — and which
  failures were already failing on `main` — is far quicker to review than one that leaves
  it implied.
- Keep it focused: one milestone task per PR.

Pull requests are merged with a merge commit once reviewed. There is no CLA; the project
is MIT ([ADR 0018](docs/adr/0018-license-mit.md)).
