# CONTEXT.md — resume point

Last updated: 2026-09-11. Owner: main session. Status: scaffolding phase, no app code yet.

## What we know

- Legacy in `~/Tools`: 12 dirs. Infra `infra/compose.yaml` runs 11 services (3x mongo 27017/27018/27019, redis 6379, rabbitmq 5672/15672, ticker-cache 4001, sender 3009, coin-lister 4000, potential 10000, monitor 5001, gate-proxy 10001:42069). All `image: xxx:latest` built from per-service `Dockerfile + Makefile`, zero `build:` contexts. `update-repo.sh` clones e9cryptteam + `make`.
- Pain: `sender/utils/reset.js + files-builder clearDB deleteMany`, `potential boot deleteMany`, codegen `out/*` + `spawn/kill`, `PUT` requires 30+ keys, string `"0.1"` bug, committed `dist/*.json`, dead Go + index2-5/worker files, empty `sender/docker-compose.yml`.
- No `*function*/*logid*` files — only `crawler-logs` AMQP queue. To be replaced by `LogId` in observability.
- Decisions locked: Effect 4 RC only, Postgres+Drizzle full move, signal-card rewritten as Effect server with real templates (not nginx static), portainer out of scope, activate/deactivate event-driven.

## Where we are

- [x] Recon ~/Tools + versions (effect 3.22.2/4.0.0-rc.113, drizzle 0.45.2/kit 0.31.10, TS 7.0.2 latest)
- [x] `git init` in rawr (branch master → rename to main on first commit)
- [ ] Scaffold files in this batch: AGENTS/CONTEXT/docs-plan/TODO/.opencode/agents/opencode.json/.vscode
- [ ] Next: pnpm-workspace + TS7 + Effect RC install + repos/effect subtree + drizzle + infra compose

## How to continue

1. Read `AGENTS.md`, `docs/plan.md`, `TODO.md`.
2. Pick top unchecked item in `TODO.md`, delegate to matching `.opencode/agents/*` via Task.
3. Update `CONTEXT.md` Last updated + Where we are before closing session.
4. Commit with `git add -A && git commit -m "..."`.

## Open questions

- Keep RabbitMQ+Redis behind ports for v1 (recommended) vs full Effect Cluster now?
- Postgres schema naming: `snake_case` + Drizzle `pgTable`?
- Signal-card template engine: Effect Platform HTML vs Eta/Handlebars?
