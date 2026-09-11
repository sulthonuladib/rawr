# CONTEXT.md — resume point

Last updated: 2026-09-11. Owner: main session. Status: Phase 0 foundation scaffolded, `pnpm i/check/test/build` + `docker compose config` green; `packages/domain` implemented (`pnpm --filter @rawr/domain check` green, NOT committed); `packages/config` implemented (`pnpm --filter @rawr/config check` green + runtime smoke green, NOT committed).

## What we know

- Legacy in `~/Tools`: 12 dirs. Infra `infra/compose.yaml` runs 11 services (3x mongo 27017/27018/27019, redis 6379, rabbitmq 5672/15672, ticker-cache 4001, sender 3009, coin-lister 4000, potential 10000, monitor 5001, gate-proxy 10001:42069). All `image: xxx:latest` built from per-service `Dockerfile + Makefile`, zero `build:` contexts. `update-repo.sh` clones e9cryptteam + `make`.
- Pain: `sender/utils/reset.js + files-builder clearDB deleteMany`, `potential boot deleteMany`, codegen `out/*` + `spawn/kill`, `PUT` requires 30+ keys, string `"0.1"` bug, committed `dist/*.json`, dead Go + index2-5/worker files, empty `sender/docker-compose.yml`.
- No `*function*/*logid*` files — only `crawler-logs` AMQP queue. To be replaced by `LogId` in observability.
- Decisions locked: Effect 4 RC only, Postgres+Drizzle full move, signal-card rewritten as Effect server with real templates (not nginx static), portainer out of scope, activate/deactivate event-driven.

## Where we are

- [x] Recon ~/Tools + versions (effect 3.22.2/4.0.0-rc.113, drizzle 0.45.2/kit 0.31.10, TS 7.0.2 latest)
- [x] `git init` in rawr (branch master → rename to main on first commit)
- [x] Scaffold files: AGENTS/CONTEXT/docs-plan/TODO/.opencode/agents/opencode.json/.vscode
- [x] pnpm monorepo foundation (this session): `pnpm-workspace.yaml` catalog, root `package.json`, `tsconfig.base.json`, `.node-version`, `drizzle.config.ts`, `infra/compose.yaml` v1, 13 workspace skeletons, `drizzle/schema.ts`, `agent-patterns/` — `pnpm i`, `pnpm check/test/build`, `docker compose config` all green, `tsc` 7.0.2 verified. NOT committed.
- [x] `agent-patterns/effect-schema.md` (84 lines): Schema constructors, decodeUnknown/encode, brand, TaggedError, don'ts — from `repos/effect/.../Schema.ts + ai-docs/02_schema/10_schema-basics.ts + TestSchema.test.ts`. `tsconfig.base.json` check: all 13 `packages/*/apps/*/tsconfig.json` extend it, 0 fixes needed.
- [x] `packages/domain` (this session): `CmcId/Symbol/AlternateSymbol` brands, exact-15 `Exchange` union (`upbitUsdt` camelCase per legacy model), `ActiveCoin` with per-exchange `{enabled, alternate}`, `CoinStatus` tagged union, `OrderbookTick`, `Opportunity`, `CoinUpdated` event, `CoinNotFound|InvalidCoinError|StoreUnavailable` — `check` green + runtime smoke test green. NOT committed.
- [x] `packages/config` (this session): `Config` (`databaseUrl/redisUrl/amqpUrl/cmcApiKey` as `Redacted`, `potentialHost` default `"localhost"`, `ports` with legacy defaults 4000/4001/3009/5001/10000/42069/5000), `ConfigError` TaggedError, `loadConfig: Effect<Config, ConfigError>` — `check` green + runtime smoke green (defaults, redaction, missing-key + bad-port failures). NOT committed.
- [ ] Next: coin-store + messaging (`@effect-domain`)
- [ ] Notes: `@effect/platform@0.97.2` + `@effect/sql@0.52.1` are Effect 3-only (peer `effect@^3.22`, verified via `pnpm view`) — NOT pinned. v4 line pins `@effect/platform-node@4.0.0-rc.113`, `@effect/platform-node-shared@4.0.0-rc.113`, `@effect/sql-pg@4.0.0-rc.113`. TS7 quirk: `esModuleInterop` flag removed in 7.0.2 (dropped from base config). `pnpm approve-builds --all` applied for esbuild (drizzle-kit transitive) so `pnpm run` scripts pass status check.

## How to continue

1. Read `AGENTS.md`, `docs/plan.md`, `TODO.md`.
2. Pick top unchecked item in `TODO.md`, delegate to matching `.opencode/agents/*` via Task.
3. Update `CONTEXT.md` Last updated + Where we are before closing session.
4. Commit with `git add -A && git commit -m "..."`.

## Open questions

- Keep RabbitMQ+Redis behind ports for v1 (recommended) vs full Effect Cluster now?
- Postgres schema naming: `snake_case` + Drizzle `pgTable`?
- Signal-card template engine: Effect Platform HTML vs Eta/Handlebars?
