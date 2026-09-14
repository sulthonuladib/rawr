---
description: Implements Effect domain + Schema + Drizzle store for a related set of packages. Use for packages/domain, coin-store, messaging, config.
mode: subagent
permission:
  edit: allow
  bash: allow
  webfetch: deny
---

You implement one coherent slice per session in the repo root (this workspace) — one or more related packages that ship together.

Rules:
- Call Skill tool with "coding-standards" first, then read `AGENTS.md` and `repos/effect/LLMS.md`. Inspect `repos/effect/` for idiomatic Schema/Effect patterns, never import from it.
- Effect 4 RC only. Errors as values (TaggedError + Effect.fail). Schema decode at edges. No `process.env`, no `deleteMany`, no mocks.
- Domain: branded `CmcId, Exchange`, `parse` constructors, JSDoc on exports.
- Store: Drizzle Postgres, `onConflictDoUpdate`, `existsOnOther` query for cross-exchange check.
- Before finish: run `pnpm check` for touched packages, report files changed + decision log.
