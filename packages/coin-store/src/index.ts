/**
 * `@rawr/coin-store` — Drizzle Postgres repositories.
 *
 * Phase 1 implementation: `pgTable` definitions for `active_coins`, `exchange_symbols`,
 * `orderbook_snapshots`, and `opportunities` (snake_case, see `schema.ts`) plus repository
 * functions (`findActiveById` / `listActive` / `upsertActive` / `setStatus` / `existsOnOther`
 * in `active-coins.ts`; `saveSnapshot` / `saveOpportunity` / `listOpportunities` in
 * `market-store.ts`).
 *
 * Rules: every function returns an `Effect` with domain `TaggedError`s (`CoinNotFound`,
 * `StoreUnavailable`, `InvalidCoinError`) — never `throw`. Every row is parsed via domain
 * Schemas before it reaches callers. Never `deleteMany` / `clearDB` here — coin
 * activate/deactivate flows only via the `CoinUpdated` event plus `setStatus`. The
 * composition root builds the `Db` client from `packages/config` `databaseUrl` and injects it.
 *
 * @module
 */

/** Package identifier for `@rawr/coin-store`. */
export const packageName = "@rawr/coin-store" as const

/** Drizzle tables, row types, full schema, and the `Db` port. */
export {
  activeCoins,
  exchangeSymbols,
  opportunities,
  orderbookSnapshots,
  schema
} from "./schema.js"

/** Drizzle row types (infrastructure shapes — parse into domain types before use). */
export type {
  ActiveCoinInsert,
  ActiveCoinRow,
  Db,
  ExchangeSymbolInsert,
  ExchangeSymbolRow,
  OpportunityInsert,
  OpportunityRow,
  OrderbookSnapshotInsert,
  OrderbookSnapshotRow
} from "./schema.js"

/** `active_coins` repository: find / list / upsert / lifecycle / cross-exchange check. */
export {
  existsOnOther,
  findActiveById,
  listActive,
  setStatus,
  toActiveCoin,
  toActiveCoinInsert,
  upsertActive
} from "./active-coins.js"

/** Snapshots + opportunities repository. */
export {
  listOpportunities,
  saveOpportunity,
  saveSnapshot
} from "./market-store.js"

/** Market-store input/output shapes. */
export type {
  ListOpportunitiesOptions,
  StoredOpportunity
} from "./market-store.js"
