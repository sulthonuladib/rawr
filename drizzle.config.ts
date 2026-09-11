import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration (Phase 0 foundation).
 *
 * - `schema` points at the Drizzle table definitions (see `drizzle/schema.ts`).
 * - `out` holds generated SQL migrations (`pnpm db:generate`).
 * - Apply with `pnpm db:migrate`. `DATABASE_URL` is read here only for
 *   tooling; app code must use `packages/config` Schema instead of
 *   `process.env` sprawl.
 */
export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env["DATABASE_URL"] ??
      "postgres://rawr:rawr@localhost:5432/rawr",
  },
});
