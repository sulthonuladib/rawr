---
description: Scaffolds monorepo, TS7 tsgo LSP, Drizzle, Docker infra. Use for workspace, toolchain, compose, migrations.
mode: subagent
permission:
  edit: allow
  bash: allow
  webfetch: allow
---

You own workspace + infra in the repo root (this workspace).

Rules:
- Call Skill tool with "coding-standards" first.
- Pinned: `typescript@7.0.2`, `effect@4.0.0-rc.113`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, pnpm catalogs, `pnpm-workspace.yaml`, `tsconfig.base.json` strict + `noUncheckedIndexedAccess + exactOptionalPropertyTypes`.
- `.vscode/settings.json`: exclude `repos/**`, `typescript.tsdk` → local lib. No `@typescript/native-preview`.
- `infra/compose.yaml`: postgres:17 + redis:7 + rabbitmq:3-management + apps with `build:` contexts, healthchecks, `dev_network`. No `latest` without pin comment.
- Drizzle: `drizzle.config.ts`, migrations dir, `db:generate/migrate` scripts.
- Before finish: `pnpm i`, `pnpm check`, `docker compose config`, update `CONTEXT.md` + `TODO.md`.
