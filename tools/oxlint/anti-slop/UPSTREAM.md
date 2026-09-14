# UPSTREAM.md — anti-slop vendored plugin provenance

Source: skill bundle `install-anti-slop`, assets at
`<skills>/install-anti-slop/assets/anti-slop`, copied verbatim via
`<skills>/install-anti-slop/scripts/install.mjs` (no `--force`, no edits).

Upstream repository / exact source commit: unknown — the bundle carries no
version metadata, so no revision is recorded rather than guessed. To
establish it later, compare `tools/oxlint/anti-slop/` against the upstream
anti-slop source and append the commit here.

Installed paths in this repo:
- `tools/oxlint/anti-slop/index.ts` — generic plugin (`anti-slop`), 18 rules.
- `tools/oxlint/anti-slop/effect/index.ts` — opt-in Effect plugin
  (`anti-slop-effect`), 5 rules.
- `tools/oxlint/anti-slop/vendor/eslint-stylistic/` — vendored readability
  helper with its own `LICENSE`; self-contained, no Stylistic dependency.

Intentional deviations from the bundle: none.

Runtime: `oxlint` + `@oxlint/plugins` pinned in lockstep in the
`pnpm-workspace.yaml` catalog (`catalog:` refs in root `devDependencies`).
Registered in root `oxlint.config.ts` (`jsPlugins`, ignores, all generic +
Effect rules at `"error"`).
