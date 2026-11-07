# 0020: Admin dark mode follows the system, with an in-admin override

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

The admin had no dark mode. ADR 0019 rule 4 fixed the _mechanism_ without committing to ship one: dark values go on `.lontar-admin[data-theme='dark']` and under a `prefers-color-scheme` query scoped to the wrapper, never on a bare `.dark` class on `:root`, because a host app running shadcn already owns that selector. What was left open (#121) is who decides which theme is shown:

1. **The operating system only.** `prefers-color-scheme`, nothing stored, no UI. The simplest option, but a user whose OS is dark and who prefers a light admin (or the reverse) cannot change it.
2. **The host application**, through an `<Admin theme="…">` prop. The admin would match the host's own theme. But it puts a decision about the editor's preference in the host developer's hands, and it adds public API to `README.md`'s spec for a choice most hosts will not want to make.
3. **The system by default, with an override inside the admin.** The person editing content chooses, and the choice persists in their browser.

The admin is a library rendered inside someone else's page (ADR 0001), so whatever is persisted must not collide with the host's own storage, and nothing may restyle the host page (architecture rule 7).

## Decision

Option 3: follow the system by default, and offer a Light / Dark / System toggle in the admin.

1. **Default is the system.** With no stored choice the wrapper has no `data-theme`. `@media (prefers-color-scheme: dark)` applies the dark tokens to `.lontar-admin:not([data-theme='light'])`, so the system case needs no JavaScript and is correct from the first paint.
2. **An explicit choice sets `data-theme`** on the `.lontar-admin` wrapper: `light` or `dark`. `.lontar-admin[data-theme='dark']` carries the same dark tokens as the media query; `data-theme='light'` opts out of the media query. Choosing System removes the attribute.
3. **The choice persists in `localStorage` under `lontar-admin-theme`.** The key is prefixed, so it cannot collide with a host's keys. Every read and write is wrapped, because storage can be unavailable (private windows, blocked site data, a sandboxed iframe); when it is, the toggle still works for the session and the admin falls back to System on the next load.
4. **`data-theme` is only applied after mount.** The admin's first render is identical on the server and the client (the existing `mounted` gate in `Admin.tsx`), so reading storage before mount would cause a hydration mismatch. The cost is that an explicit choice that differs from the OS shows the system theme for the length of the initial loading screen. The System case is unaffected.
5. **Dark values are a second set of the same `--lontar-*` tokens.** No new public tokens. `color-scheme` is set alongside them, so native controls inside the admin (scrollbars, the time input in the date picker) follow the theme. Hardcoded colours left in the hand-written CSS are replaced with tokens, so every surface responds.
6. **Host overrides are per theme.** A host that overrides tokens on `.lontar-admin` changes the light theme. The dark blocks are more specific (`.lontar-admin[data-theme='dark']`, and `.lontar-admin:not([data-theme='light'])` inside the media query), so a light override does not bleed into dark, where its colour may not work. To theme dark, a host targets the same two selectors; `README.md` documents both.

## Consequences

- An editor gets dark mode with no setup, and can override it without the host doing anything.
- The dark tokens are declared twice, once for the media query and once for `[data-theme='dark']`, because a media query cannot be combined with an attribute selector in one rule. A unit test asserts the two blocks declare the same tokens with the same values, and that every public token has a dark value, so they cannot drift.
- A host that wants to force a theme for every editor has no prop to do it. It can set `data-theme` on the wrapper from its own code, or override the dark tokens with the light values. If that need turns out to be common, a `theme` prop that wins over the stored choice can be added later without breaking this model.
- The toggle lives in the sidebar, so it is not available on the login page. The stored choice and the system theme both still apply there.
