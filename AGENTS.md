# AGENTS.md

### Stack (versions pinned in `pnpm-workspace.yaml` catalog + `infra/compose.yaml` — read them there)

- `effect` (v4 RC line) + `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/sql-pg` (same RC line), `Schema` everywhere at edges
- `typescript` native (tsgo built-in), `@effect/language-service`, `effect-vscode`
- `drizzle-orm + drizzle-kit`, Postgres
- `pnpm`, `node`, Redis + RabbitMQ behind ports

### Vendored Repositories

This project vendors external repos under `repos/` per https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive

- `repos/effect` = git subtree of Effect-TS/effect, `--squash`
- Use as read-only reference for idiomatic Effect/Schema patterns. Prefer vendored source + tests over web search.
- Do NOT edit `repos/**`. Do NOT import from `repos/**` — app code imports from npm `effect`.
- When writing Effect code, inspect `repos/effect/` + `repos/effect/LLMS.md`. Capture reusable idioms to `agent-patterns/`.

### Commands

- `pnpm i`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm dev`, `pnpm check`, `pnpm test`
- `git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash`
