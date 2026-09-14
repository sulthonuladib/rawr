/**
 * Drizzle schema entrypoint.
 *
 * Re-exports the real `@rawr/coin-store` tables (`cryptocurrencies`,
 * `exchanges`, `exchange_cryptocurrency`, `chains`,
 * `exchange_cryptocurrency_chain`, `exchange_snapshots`,
 * `exchange_opportunities`, all snake_case). Generate migrations with
 * `pnpm db:generate`, apply with `pnpm db:migrate`.
 *
 * @module
 */
export * from "../packages/coin-store/src/schema.js";
