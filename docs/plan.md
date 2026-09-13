# Plan — Tools → rawr rewrite

## Phase 0 — Foundation (done, committed on `main`)

- [x] git init + rename to `main`
- [x] `pnpm-workspace.yaml` with catalog (effect rc, platform, sql), `tsconfig.base.json` TS7 strict, `.node-version`, `.vscode/settings.json` (repos exclude + tsdk), `opencode.json`, `.gitignore`
- [x] `repos/effect` subtree `--squash` + `agent-patterns/effect-schema.md`
- [x] `packages/config, domain, observability` skeletons → implemented (`3125cbc`, `530d802`, `7085ad4`)
- [x] `infra/compose.yaml` v1 (postgres, redis, rabbitmq only) to unblock dev

## Phase 1 — Domain + Store (done, committed on `main`)

- `packages/domain`: Schema `CmcId, Exchange, ActiveCoin, OrderbookTick, Opportunity, CoinUpdated`, errors `CoinNotFound|StoreUnavailable` — done (`3125cbc`)
- `packages/coin-store`: Drizzle tables `active_coins, exchange_symbols, orderbook_snapshots, opportunities`, repos with `find/update/upsert`, no deleteMany, `existsOnOther(cmcId, exchange)` query — done (`175a916`)
- `packages/messaging`: `CoinUpdated` PubSub + RabbitMQ adapter, `packages/config`: Env Schema — done (`e33db68`, `530d802`)

Delegate to `@effect-domain`.

## Phase 2 — Services

- `apps/coin-admin-api`: `HttpApi PUT/PATCH /coins/:cmcId` → tx update → publish `CoinUpdated`
- `apps/ingest-sender`: `FiberMap` subscribe/unsubscribe on event, activate/deactivate only delta
- `apps/ingest-receiver`: consume → decode → upsert snapshot
- `apps/arbitrage-engine`: Stream join → calc 2M vol ≥0.1% → upsert opportunity + WS push (merges potential+galactus)
- `apps/ticker-cache, crawler-monitor, gate-proxy`: Schedule cache, crawler-logs fan-out, thin proxy

Delegate to `@effect-service` per app.

## Phase 3 — UI + Infra

- `apps/signal-card`: Effect HttpServer + HTML templates, rewrite table/makerman/management/services/monitor rendering
- `infra/compose.yaml` full (8 apps with `build:`), Dockerfiles, `db:migrate` job
- Delete legacy list only after parity test

Delegate to `@effect-infra` + `@effect-service`.

## Guardrails

- No direct DB clear. Expiry via `expiredAt` + scheduled job.
- All edges Schema decode. All secrets Redacted. All WS/AMQP reconnect via Schedule.
- Verify: `pnpm check`, `pnpm test`, `docker compose config`, boot postgres + migrate + 1 coin activate/deactivate roundtrip.
