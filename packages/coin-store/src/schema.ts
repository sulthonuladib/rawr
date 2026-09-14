/**
 * `@rawr/coin-store/schema` — Drizzle Postgres tables (relational).
 *
 * `cryptocurrencies` (one row per coin, unique `cmc_id`, `status` enum +
 * `reason` lifecycle), `exchanges` (one row per exchange, unique `slug`,
 * seeded with the 15 supported exchanges), `exchange_cryptocurrency` (one row
 * per coin per exchange carrying `enabled` and the alternate-symbol override,
 * unique `(cryptocurrency_id, exchange_id)`), `chains` (transfer-network
 * registry, unique `code`), and `exchange_cryptocurrency_chain` (per-listing
 * chain capabilities with withdraw/deposit flags and exchange-code/name
 * overrides) — plus the two hot tables `exchange_snapshots` and
 * `exchange_opportunities`, FK-backed into the listing graph with supporting
 * indexes.
 *
 * Table names follow the arbitrator lister (`exchange`, `cryptocurrency`,
 * `exchange_cryptocurrency`, `exchange_cryptocurrency_chain`, `chain`).
 * Postgres columns are `snake_case`. The `upbit_usdt` exchange slug (and AMQP
 * queue name) maps to the domain `upbitUsdt` value at the repository boundary
 * (`exchangeToSlug` / `slugToExchange` in `exchanges.ts`); the DB always
 * stores the snake_case slug.
 *
 * Rule: no `deleteMany` / `clearDB` anywhere in this package — rows are inserted or
 * upserted only. There is no coin repository in this package — services query
 * these tables directly for what they need.
 *
 * @module
 */
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core"
import type { PgDatabase } from "drizzle-orm/pg-core/db"
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session"

/**
 * Coin lifecycle stored on `cryptocurrencies.status`.
 *
 * `active` / `inactive` — services apply status changes in their own queries;
 * rows are never deleted. Matches the domain `CoinStatus` tagged union.
 */
export const cryptocurrencyStatusEnum = pgEnum("cryptocurrency_status", ["active", "inactive"])

/** Type-level cryptocurrency status (`"active" | "inactive"`). */
export type CryptocurrencyStatusValue = (typeof cryptocurrencyStatusEnum.enumValues)[number]

/**
 * Fresh `created_at` / `updated_at` columns per table.
 *
 * Called per `pgTable` so each table gets its own builders (builders cannot
 * be shared across tables). Mirrors the arbitrator `addDefaultTimestampFields`
 * helper.
 */
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

/**
 * Canonical cryptocurrency row, keyed by surrogate `id`, domain identity `cmc_id`.
 *
 * `status` + `reason` carry the lifecycle; rows are never deleted. `cmc_id`
 * stays the domain identity (branded `CmcId`, still unique).
 */
export const cryptocurrencies = pgTable("cryptocurrencies", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  cmcId: integer("cmc_id").notNull().unique(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  logo: text("logo").notNull(),
  status: cryptocurrencyStatusEnum("status").notNull().default("active"),
  reason: text("reason").notNull().default(""),
  ...timestamps()
})

/** Select (read) shape of a `cryptocurrencies` row. */
export type CryptocurrencyRow = typeof cryptocurrencies.$inferSelect

/** Insert (write) shape of a `cryptocurrencies` row. */
export type CryptocurrencyInsert = typeof cryptocurrencies.$inferInsert

/**
 * Exchange registry: one row per supported exchange.
 *
 * New exchange = `INSERT`, zero migration. Seeded with the 15 supported
 * slugs (`upbit` and `upbit_usdt` as separate rows) — see `EXCHANGE_SEED`.
 */
export const exchanges = pgTable("exchanges", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps()
})

/** Select (read) shape of an `exchanges` row. */
export type ExchangeRow = typeof exchanges.$inferSelect

/** Insert (write) shape of an `exchanges` row. */
export type ExchangeInsert = typeof exchanges.$inferInsert

/**
 * Seed rows for `exchanges` (15 supported exchanges).
 *
 * Slugs are the DB/queue spelling (`upbit_usdt` snake_case); the domain
 * `Exchange` union keeps the model spelling (`upbitUsdt` camelCase) with a
 * one-entry mapping at the repository boundary.
 */
export const EXCHANGE_SEED: ReadonlyArray<{ readonly slug: string; readonly name: string }> = [
  { slug: "binance", name: "Binance" },
  { slug: "indodax", name: "Indodax" },
  { slug: "huobi", name: "Huobi" },
  { slug: "bybit", name: "Bybit" },
  { slug: "okx", name: "OKX" },
  { slug: "kucoin", name: "KuCoin" },
  { slug: "mexc", name: "MEXC" },
  { slug: "bittime", name: "Bittime" },
  { slug: "bitget", name: "Bitget" },
  { slug: "gateio", name: "Gate.io" },
  { slug: "upbit", name: "Upbit" },
  { slug: "upbit_usdt", name: "Upbit USDT" },
  { slug: "pintu", name: "Pintu" },
  { slug: "reku", name: "Reku" },
  { slug: "bitmart", name: "BitMart" }
]

/**
 * Single source of truth for listings: one row per (cryptocurrency, exchange).
 *
 * `enabled` mirrors the listing flag; `alternate_symbol` carries the
 * tradable-symbol override (`""` means no override — resolve to the canonical
 * coin symbol). Unique `(cryptocurrency_id, exchange_id)` with cascade FKs.
 */
export const exchangeCryptocurrencies = pgTable(
  "exchange_cryptocurrency",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    cryptocurrencyId: integer("cryptocurrency_id")
      .notNull()
      .references(() => cryptocurrencies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    exchangeId: integer("exchange_id")
      .notNull()
      .references(() => exchanges.id, { onDelete: "cascade", onUpdate: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    alternateSymbol: text("alternate_symbol").notNull().default(""),
    ...timestamps()
  },
  (table) => [
    unique("exchange_cryptocurrency_unique").on(table.cryptocurrencyId, table.exchangeId)
  ]
)

/** Select (read) shape of an `exchange_cryptocurrency` row. */
export type ExchangeCryptocurrencyRow = typeof exchangeCryptocurrencies.$inferSelect

/** Insert (write) shape of an `exchange_cryptocurrency` row. */
export type ExchangeCryptocurrencyInsert = typeof exchangeCryptocurrencies.$inferInsert

/**
 * Transfer-network registry (e.g. `BTC`, `ETH`, `TRX`).
 *
 * Canonical `code` plus display `name`; per-exchange spellings live on
 * `exchange_cryptocurrency_chain` as overrides.
 */
export const chains = pgTable("chains", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps()
})

/** Select (read) shape of a `chains` row. */
export type ChainRow = typeof chains.$inferSelect

/** Insert (write) shape of a `chains` row. */
export type ChainInsert = typeof chains.$inferInsert

/**
 * Per-listing transfer capabilities: one row per (listing, chain).
 *
 * `exchange_chain_code` is the exchange's spelling of the chain code;
 * `exchange_chain_name` is an optional override (`null` = no override).
 * `withdraw_enabled` / `deposit_enabled` default to `true`. Transfer speed is
 * derived from these flags at read time — no cached string is stored.
 */
export const exchangeCryptocurrencyChains = pgTable(
  "exchange_cryptocurrency_chain",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    exchangeCryptocurrencyId: integer("exchange_cryptocurrency_id")
      .notNull()
      .references(() => exchangeCryptocurrencies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade", onUpdate: "cascade" }),
    exchangeChainCode: text("exchange_chain_code").notNull(),
    exchangeChainName: text("exchange_chain_name"),
    withdrawEnabled: boolean("withdraw_enabled").notNull().default(true),
    depositEnabled: boolean("deposit_enabled").notNull().default(true),
    ...timestamps()
  },
  (table) => [
    unique("exchange_cryptocurrency_chain_unique").on(table.exchangeCryptocurrencyId, table.chainId)
  ]
)

/** Select (read) shape of an `exchange_cryptocurrency_chain` row. */
export type ExchangeCryptocurrencyChainRow = typeof exchangeCryptocurrencyChains.$inferSelect

/** Insert (write) shape of an `exchange_cryptocurrency_chain` row. */
export type ExchangeCryptocurrencyChainInsert = typeof exchangeCryptocurrencyChains.$inferInsert

/**
 * Append-only orderbook ticks, one row per cryptocurrency per exchange per capture.
 *
 * FK-backed to `cryptocurrencies` + `exchanges` (the cheapest join-safe form).
 * Prices/amounts use `numeric` in `number` mode; `0` means "missing" upstream
 * (guards skip `buyPrice != 0` rows). Rows are never updated or deleted here —
 * retention is a future scheduled job on `captured_at`. Composite index on
 * `(cryptocurrency_id, exchange_id, captured_at)` backs engine stream joins and
 * retention deletes-by-time.
 */
export const exchangeSnapshots = pgTable(
  "exchange_snapshots",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    cryptocurrencyId: integer("cryptocurrency_id")
      .notNull()
      .references(() => cryptocurrencies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    exchangeId: integer("exchange_id")
      .notNull()
      .references(() => exchanges.id, { onDelete: "cascade", onUpdate: "cascade" }),
    buyPrice: numeric("buy_price", { mode: "number" }).notNull(),
    sellPrice: numeric("sell_price", { mode: "number" }).notNull(),
    buyAmount: numeric("buy_amount", { mode: "number" }).notNull(),
    sellAmount: numeric("sell_amount", { mode: "number" }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    ...timestamps()
  },
  (table) => [
    index("exchange_snapshots_crypto_exchange_captured_idx").on(
      table.cryptocurrencyId,
      table.exchangeId,
      table.capturedAt
    )
  ]
)

/** Select (read) shape of an `exchange_snapshots` row. */
export type ExchangeSnapshotRow = typeof exchangeSnapshots.$inferSelect

/** Insert (write) shape of an `exchange_snapshots` row. */
export type ExchangeSnapshotInsert = typeof exchangeSnapshots.$inferInsert

/**
 * Arbitrage opportunities between two exchanges for one coin.
 *
 * FK-backed to `cryptocurrencies` + `exchanges` (buy/sell legs). `profit_percentage` is
 * `numeric` because the engine computes it as a number (the domain keeps the
 * `toFixed(2)` string form — trailing zeros normalize on the roundtrip,
 * numeric equality is preserved). Expiry: rows carry `expired_at` and a
 * scheduled job filters them — never `deleteMany`. Index on
 * `(expired_at, profit_percentage)` backs the live-opportunities read
 * (`WHERE expired_at > now ORDER BY profit DESC LIMIT n`).
 */
export const exchangeOpportunities = pgTable(
  "exchange_opportunities",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    cryptocurrencyId: integer("cryptocurrency_id")
      .notNull()
      .references(() => cryptocurrencies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    buyExchangeId: integer("buy_exchange_id")
      .notNull()
      .references(() => exchanges.id, { onDelete: "cascade", onUpdate: "cascade" }),
    sellExchangeId: integer("sell_exchange_id")
      .notNull()
      .references(() => exchanges.id, { onDelete: "cascade", onUpdate: "cascade" }),
    symbol: text("symbol").notNull(),
    buyPrice: numeric("buy_price", { mode: "number" }).notNull(),
    sellPrice: numeric("sell_price", { mode: "number" }).notNull(),
    buyAmount: numeric("buy_amount", { mode: "number" }).notNull(),
    sellAmount: numeric("sell_amount", { mode: "number" }).notNull(),
    profitPercentage: numeric("profit_percentage", { mode: "number" }).notNull(),
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }).notNull(),
    ...timestamps()
  },
  (table) => [
    index("exchange_opportunities_expired_profit_idx").on(table.expiredAt, table.profitPercentage)
  ]
)

/** Select (read) shape of an `exchange_opportunities` row. */
export type ExchangeOpportunityRow = typeof exchangeOpportunities.$inferSelect

/** Insert (write) shape of an `exchange_opportunities` row. */
export type ExchangeOpportunityInsert = typeof exchangeOpportunities.$inferInsert

/**
 * Full Drizzle schema for this package (all seven tables).
 *
 * Pass to the driver at the composition root, e.g. `drizzle(pool, { schema })`, and to
 * `drizzle-kit` via the root `drizzle/schema.ts` re-export (first real
 * migration).
 */
export const schema = {
  cryptocurrencies,
  exchanges,
  exchangeCryptocurrencies,
  chains,
  exchangeCryptocurrencyChains,
  exchangeSnapshots,
  exchangeOpportunities,
  cryptocurrencyStatusEnum
}

/**
 * Driver-agnostic Drizzle database port for the repositories in this package.
 *
 * Narrow application-owned port in the coding-standards sense: repositories depend only on
 * this structural `PgDatabase` type (any driver — `node-postgres`, `postgres-js`, proxies —
 * satisfies it), never on a concrete pool or client. The composition root builds the real
 * client from `packages/config` `databaseUrl` (`Redacted` — unwrap once at the call site)
 * and injects it.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
