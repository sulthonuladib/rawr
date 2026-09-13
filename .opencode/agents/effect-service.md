---
description: Implements one Effect service app (coin-admin-api, ingest-sender/receiver, arbitrage-engine, ticker-cache, monitor, gate-proxy, signal-card).
mode: subagent
permission:
  edit: allow
  bash: allow
  webfetch: deny
---

You implement ONE app per session in `apps/*` of the repo root (this workspace).

Rules:
- Call Skill tool with "coding-standards" first, then read `AGENTS.md`, `CONTEXT.md`, `docs/plan.md`. Reference `~/Tools/<legacy>/src` read-only for behavior, do not copy tech debt.
- Effect 4 RC + Platform HttpApi/HttpServer, Layer wiring, Config Schema, Redacted secrets.
- Coin activate/deactivate only via `CoinUpdated` event + `FiberMap` diff. Never `clearDB/deleteMany/clearFiles`. Verify `existsOnOther` before subscribe.
- WS/AMQP with reconnect Schedule. Structured logs with coin/exchange/operation tags.
- Before finish: `pnpm check`, smoke boot if possible, update `CONTEXT.md` + `TODO.md`, report endpoint + event contract + test done.
