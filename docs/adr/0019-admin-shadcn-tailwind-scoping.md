# 0019: Admin styling with Tailwind v4 and shadcn/ui, scoped to the admin

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Every admin style lives in one hand-written file, `packages/admin/src/styles.css` (1,399 lines), with manually authored class names. There is no Tailwind, no Radix, no `class-variance-authority`, and no `components.json`. `AGENTS.md` records shadcn/ui and scoped Tailwind v4 as _planned_ admin styling for M6, tracked in #123; this ADR is the decision that milestone waits on.

Adopting shadcn would stop the admin from reimplementing primitives that mature libraries already provide. But the admin is not an application: it is a prebuilt library ([0001](0001-spa-admin.md)) that renders inside someone else's page. Architecture rule 7 in `AGENTS.md` requires that its CSS never leak into the host app, and the current stylesheet honours that by scoping every rule under a single `.lontar-admin` wrapper (`packages/admin/src/Admin.tsx:51`).

Three properties of the shadcn stack fight that arrangement:

1. **Tailwind utilities are global by construction.** `.flex` and `.p-4` are top-level class selectors. A parent selector cannot scope them. Shipped as-is they would collide with any host app that also uses Tailwind, at a different version or with a different config.
2. **Preflight is a global reset.** It targets `*`, `button`, `h1` and friends. Bundled into the admin's stylesheet it would reset the _host_ application, which is precisely the leak rule 7 forbids.
3. **Radix renders through portals.** Select, Dialog, Popover, Tooltip and DropdownMenu mount into `document.body` — outside the `.lontar-admin` wrapper. Scoped CSS never reaches them, so portalled content renders unstyled. The obvious fix, a few global rules, reintroduces the leak.

There is also a packaging constraint. `packages/admin/vite.config.ts` externalises only `react`, `react-dom` and `react/jsx-runtime`; everything else is bundled into the published `dist/index.js`. Whatever shadcn pulls in ships to every user.

Finally, `styles.css` already defines 18 custom properties on `.lontar-admin` (`--lontar-primary`, `--lontar-bg`, `--lontar-radius`, …). `README.md` documents them as the supported theming surface, so they are a published contract, not an implementation detail — and shadcn arrives with its own unprefixed token names on `:root`.

## Decision

Adopt Tailwind v4 and shadcn/ui in `packages/admin`, under five rules.

**1. Every utility is prefixed.** Import theme and utilities with a prefix, and never the preflight layer:

```css
@import 'tailwindcss/theme.css' prefix(lt);
@import 'tailwindcss/utilities.css' prefix(lt);
```

Classes are written `lt:flex`, `lt:p-4`. The prefix is an implementation detail, not a public API.

**2. Preflight does not ship.** The base reset the admin currently inherits from browser defaults is written by hand inside `.lontar-admin`. This is more work than importing preflight, and it is the price of not touching the host page.

**3. No Radix portal without an explicit container.** A `PortalContainer` context provides a ref to a node inside the `.lontar-admin` wrapper, and every `*.Portal` receives it as `container`. Portalled content therefore stays inside the scope, and no global rule is ever needed to style it. A forgotten `container` prop is a scoping bug that no test will catch, so this is enforced mechanically — a wrapper component around each portalled primitive, or a lint rule — rather than by convention.

**4. `--lontar-*` stays the public theming surface.** shadcn's token names are mapped onto the existing custom properties rather than replacing them, and the properties stay declared on `.lontar-admin`, never on `:root`. Dark values are declared on `.lontar-admin[data-theme='dark']` and under a `prefers-color-scheme` query scoped to the wrapper; a bare `.dark` class on `:root` is not used, because a host app running shadcn already owns that selector. This fixes the mechanism without committing to shipping dark mode.

**5. Components are copied in, not installed by the CLI.** There is no `components.json` and no `@/` alias, and the shadcn CLI assumes an application rather than a Vite library build — it also installs into `dependencies`, which is wrong here. Radix, `class-variance-authority`, `clsx` and `tailwind-merge` are bundled, so they belong in `devDependencies`, matching the existing pattern and the comment in `vite.config.ts`.

To keep rule 1 and rule 2 honest, the build gains a check that the emitted `dist/styles.css` contains no selector outside `.lontar-admin`.

**Amendment (2026-11-06, while implementing #114).** That sentence is stricter than anything a build can enforce, so the check implements its intent instead. Two facts came out of the implementation:

Tailwind emits theme variables as `@layer theme { :root { … } }`, and there is no supported option to put them on another selector — `@theme` is also required to be top-level, so it cannot be nested under the wrapper. Rule 4 therefore holds by rewriting `:root` and `:host` to `.lontar-admin` in the emitted stylesheet, not by configuring Tailwind. And a prefixed utility is a top-level class selector by construction: `.lt\:flex` cannot be nested under a parent, which is exactly what the prefix in rule 1 is the mitigation for.

So the check rewrites `:root`/`:host`, then rejects every selector that is not one of three shapes:

1. a selector containing `.lontar-admin`,
2. a prefixed Tailwind utility (`.lt\:…`),
3. a rule inside `@keyframes` whose name starts with `lontar-`.

It also rejects an `@font-face`, and a `@property` registering a custom property that is not `--lt-`/`--lontar-` prefixed, since both register globally rather than matching a selector. The check lives in `packages/admin/src/build/scoped-css.ts`, runs as a Vite plugin in `generateBundle`, and fails the build.

**Amendment (2026-11-06, while implementing #115).** Two corrections, both from the first build that put real shadcn components through the check.

Rule 5 says there is no `@/` alias. That was a description of the repository at the time, written to explain why the shadcn CLI could not be used; it is not a constraint. #115 adds `@/` → `src/` in `vite.config.ts`, `tsconfig.json` and `vitest.config.ts`, so copied sources resolve `@/lib/utils` without being rewritten by hand. The rest of rule 5 stands: no `components.json`, no CLI, and the libraries go in `devDependencies`. Note that `paths` in a `tsconfig.json` replaces the base config's rather than merging with it, so the one entry the admin uses from there is repeated alongside `@/*`.

The check as described above fails on Tailwind's own output, and the two shapes it rejected are both unavoidable:

- Tailwind registers its internal custom properties with `@property --tw-*` at the top level. The configured prefix does not rename them. They are namespaced and `inherits: false`, so they change nothing on their own, and `--tw-` is now a third accepted prefix.
- Tailwind emits a Safari fallback for those same properties in `@layer properties`, declared on `*, :before, :after, ::backdrop`. That cannot be turned off, so the check scopes those selectors to the wrapper and its descendants rather than rejecting them. A universal selector anywhere outside that layer is still an error — that is what would catch an accidental preflight import.

The amended list of what may ship unscoped is therefore: a prefixed utility, a `lontar-`-prefixed `@keyframes`, a `--lt-`/`--lontar-`/`--tw-` `@property`, and the `@layer properties` fallback after scoping.

Rule 3's mechanical enforcement is a wrapper component **and** a lint rule, not one or the other. The wrappers in `packages/admin/src/components/ui` bind the container; `no-restricted-imports` in `eslint.config.js` stops the rest of the package importing `@radix-ui/*` directly and going around them.

## Alternatives considered

- **Keep the hand-written CSS.** Rejected, but it was close. It works today and leaks nothing. It also means every primitive — combobox, dialog, date picker — is ours to build and to keep accessible, which is the reinvention the stack was chosen to avoid. The deciding factor is that the admin keeps growing: every field type added since M1 brought another primitive to hand-roll, and the accessibility bugs in them are ours to find.
- **Tailwind without a prefix, trusting the `.lontar-admin` wrapper.** Rejected: the wrapper scopes our own rules, not Tailwind's. Utilities are emitted as top-level class selectors, so a host app's `.flex` and ours are the same selector, resolved by whichever stylesheet loads last.
- **Shadow DOM around the admin.** Tempting, because it would make scoping total and let preflight ship untouched. Rejected: portals, font loading, Tiptap's selection handling and React event delegation all need deliberate work to cross the boundary, and debugging becomes markedly worse. That is a large bet to take on in order to avoid a prefix.
- **CSS Modules or vanilla-extract instead of Tailwind.** Rejected: both solve scoping cleanly, and neither gives us shadcn, which is the actual goal.
- **A second admin package carrying the shadcn UI.** Rejected: two UIs over one headless core is a public plugin system for the admin, a non-goal in `docs/scope.md`. It would also duplicate the ~3,700 presentational lines that are the expensive part, while sharing only the ~725 headless ones.

## Consequences

**Easier.** Primitives come with keyboard handling and ARIA already right, which is work the admin currently carries itself. New field types get a UI faster, and `styles.css` stops growing by a block per component.

**Harder.** Writing utilities as `lt:flex` is unusual enough that contributors will get it wrong, and the build check is what catches it. The hand-written reset must be maintained as the admin grows. Every new portalled primitive is one more place to remember the `container` prop. Radix lands in the published bundle, so `dist/index.js` grows; measure it before and after rather than assuming the cost is small.

The unit suite leans on `data-testid` 94 times across 8 files, so preserving those attributes turns it into a safety net for the markup rewrite instead of a rewrite of its own. The e2e suite is less lucky: `examples/next-blog/e2e/admin.spec.ts` drives a native `<select>` at lines 53, 80 and 85 through `selectOption()` and `toHaveValue()`, neither of which works against a Radix Select.

One risk sits outside any single step: a migration abandoned halfway leaves two styling systems alive at once, which is worse than never starting. The sequence tracked in #123 is ordered so that each step ends somewhere safe.

**To revisit.** If the `container` prop keeps being forgotten despite the enforcement, the boundary is in the wrong place and Shadow DOM deserves a second look. If host apps start reporting collisions despite the prefix, the next step is shipping the admin's CSS under a cascade layer rather than widening the prefix.
