# TODO — main session checklist (update every session)

## Now

- [x] Recon ~/Tools + versions
- [x] git init rawr
- [x] Write AGENTS/CONTEXT/docs/plan/TODO/.opencode/agents
- [x] Scaffold pnpm-workspace + TS7 + Effect RC + Drizzle + 13 skeletons + infra compose v1 (main session, NOT committed)
- [ ] First commit + rename branch to main

## Next (delegate, one per subagent)

- [x] Scaffold pnpm-workspace + TS7 + Effect RC + Drizzle (`@effect-infra` — done by main session)
- [ ] Vendor repos/effect subtree + pattern file (`@effect-scout`)
- [x] Domain `@rawr/domain` (this session — `pnpm check` + runtime smoke green, NOT committed)
- [ ] coin-store + messaging (`@effect-domain`)
- [ ] coin-admin-api + ingest-sender FiberMap (`@effect-service`)
- [ ] receiver + arbitrage-engine (`@effect-service`)
- [ ] ticker-cache + monitor + gate-proxy (`@effect-service`)
- [ ] signal-card server + full compose (`@effect-infra`)

## Done log

- 2026-09-11: plan mode recon complete, build mode entered, git init done.
- 2026-09-11: Phase 0 foundation scaffolded — catalog pins (effect 4.0.0-rc.113, TS 7.0.2, drizzle-orm 0.45.2/kit 0.31.10, platform-node/-shared + sql-pg rc.113), `pnpm i/check/test/build` + `compose config` green. No commit per instructions.
- 2026-09-11: `packages/domain` implemented (brands, 15-exchange union, ActiveCoin, CoinStatus, OrderbookTick, Opportunity, CoinUpdated, 3 TaggedErrors; `check` + runtime smoke green). No commit per instructions.
- 2026-09-11: `packages/observability` implemented (LogId UUID brand + Random-v4 makeLogId, CrawlerStatus 5-literal + CrawlerReport, logWith safe-fields, ObserveError; `check` + runtime smoke green). No commit per instructions.
