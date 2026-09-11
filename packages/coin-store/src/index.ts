/**
 * `@rawr/coin-store` — Drizzle Postgres repositories.
 *
 * Skeleton placeholder (Phase 0). Phase 1 adds `pgTable` definitions for
 * `active_coins`, `exchange_symbols`, `orderbook_snapshots`,
 * `opportunities` plus repository functions (`find` / `update` / `upsert`
 * / `existsOnOther`). Never `deleteMany` / `clearDB` here — coin
 * activate/deactivate flows only via the `CoinUpdated` event.
 *
 * @module
 */

/** Package identifier for the coin-store skeleton. */
export const packageName = "@rawr/coin-store" as const;
