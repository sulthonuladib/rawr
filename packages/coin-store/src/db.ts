/**
 * Shared test database handle for `@rawr/coin-store` repository tests.
 *
 * Tooling-only (mirrors `drizzle.config.ts`): reads `DATABASE_URL` with the
 * same local fallback. Tests never delete rows (no `deleteMany` / `clearDB`
 * anywhere) — fixtures use distinctive ids/codes so reruns and parallel
 * files cannot collide.
 */
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { schema, type Db } from "./schema.js"

/** Test database URL (`DATABASE_URL`, else the local compose default). */
export const connectionString =
  process.env["DATABASE_URL"] ?? "postgres://rawr:rawr@localhost:5432/rawr"

/** Shared connection pool for the test run. */
export const pool = new pg.Pool({ connectionString })

/** Drizzle database port under test (composition root injects the real client). */
export const db: Db = drizzle(pool, { schema })
