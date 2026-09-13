# AGENTS.md

### Stack (pinned on execute)

- `effect@4.0.0-rc.113` only, `@effect/platform`, `@effect/sql`, `Schema` everywhere at edges
- `typescript@7.0.2` native (tsgo built-in), `@effect/language-service`, `effect-vscode`
- `drizzle-orm@0.45.2 + drizzle-kit@0.31.10`, Postgres 17
- `pnpm ^11.22.0`, `node ^24`, Redis 7 + RabbitMQ 3 behind ports (v1)

### Vendored Repositories

This project vendors external repos under `repos/` per https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive

- `repos/effect` = git subtree of Effect-TS/effect, `--squash`
- Use as read-only reference for idiomatic Effect/Schema patterns. Prefer vendored source + tests over web search.
- Do NOT edit `repos/**`. Do NOT import from `repos/**` — app code imports from npm `effect`.
- When writing Effect code, inspect `repos/effect/` + `repos/effect/LLMS.md`. Capture reusable idioms to `agent-patterns/`.

### Rules for subagents

- Main session orchestrates only: delegates via Task tool to `.opencode/agents/*`, reports to user.
- One ticket / one package per subagent session. Small diffs, real seams, no mocks.
- Errors as values (`Effect.fail` TaggedError), `parse don't validate` with Schema at HTTP/WS/AMQP edges.
- Never `deleteMany` / `clearDB` in app code. Coin activate/deactivate only via `CoinUpdated` event + `FiberMap` diff.
- No `process.env` sprawl — use `packages/config` Schema. No secrets in logs.
- Update `CONTEXT.md` + `TODO.md` before finishing every session.

### Commands (once scaffolded)

- `pnpm i`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm dev`, `pnpm check`, `pnpm test`
- `git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash`
