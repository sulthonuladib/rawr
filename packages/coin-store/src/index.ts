/**
 * `@rawr/coin-store` — Drizzle Postgres repositories (relational).
 *
 * `pgTable` definitions for `cryptocurrencies`, `exchanges`,
 * `exchange_cryptocurrency`, `chains`, `exchange_cryptocurrency_chain`
 * (snake_case, see `schema.ts`) plus `exchange_snapshots` and
 * `exchange_opportunities` (FK-backed, indexed) and repository functions
 * (`saveSnapshot` / `saveOpportunity` / `listOpportunities` in
 * `exchange-store.ts`; `upsertChain` / `listChains` / `upsertListingChain` /
 * `updateListingChainFlags` / `listListingChains` / `getTransferSpeed` in
 * `chains.ts`; `exchangeToSlug` / `slugToExchange` in `exchanges.ts`).
 *
 * There is no coin repository in this package — services query the tables
 * directly for what they need.
 *
 * Rules: every function returns an `Effect` with domain `TaggedError`s (`CoinNotFound`,
 * `StoreUnavailable`, `InvalidCoinError`) — never `throw`. Every row is parsed via domain
 * Schemas before it reaches callers. Never `deleteMany` / `clearDB` here. The
 * composition root builds the `Db` client from `packages/config` `databaseUrl` and injects it.
 *
 * @module
 */

/** Package identifier for `@rawr/coin-store`. */
export const packageName = "@rawr/coin-store" as const

/** Drizzle tables, row types, full schema, and the `Db` port. */
export {
  chains,
  cryptocurrencies,
  cryptocurrencyStatusEnum,
  EXCHANGE_SEED,
  exchangeCryptocurrencies,
  exchangeCryptocurrencyChains,
  exchangeOpportunities,
  exchanges,
  exchangeSnapshots,
  schema
} from "./schema.js"

/** Drizzle row types (infrastructure shapes — parse into domain types before use). */
export type {
  ChainInsert,
  ChainRow,
  CryptocurrencyInsert,
  CryptocurrencyRow,
  CryptocurrencyStatusValue,
  Db,
  ExchangeCryptocurrencyChainInsert,
  ExchangeCryptocurrencyChainRow,
  ExchangeCryptocurrencyInsert,
  ExchangeCryptocurrencyRow,
  ExchangeInsert,
  ExchangeOpportunityInsert,
  ExchangeOpportunityRow,
  ExchangeRow,
  ExchangeSnapshotInsert,
  ExchangeSnapshotRow
} from "./schema.js"

/** DB slug ↔ domain exchange mapping. */
export { exchangeToSlug, slugToExchange } from "./exchanges.js"

/** Snapshots + opportunities repository. */
export {
  listOpportunities,
  saveOpportunity,
  saveSnapshot
} from "./exchange-store.js"

/** Exchange-store input/output shapes. */
export type {
  ListOpportunitiesOptions,
  StoredOpportunity
} from "./exchange-store.js"

/** Chain registry + per-listing flags + derived transfer speed. */
export {
  getTransferSpeed,
  listChains,
  listListingChains,
  updateListingChainFlags,
  upsertChain,
  upsertListingChain
} from "./chains.js"

/** Chain input shape. */
export type { ListingChainInput } from "./chains.js"
