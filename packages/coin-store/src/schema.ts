/**
 * `@rawr/coin-store/schema` — Drizzle Postgres tables.
 *
 * `active_coins`: one row per coin keyed by `cmc_id` (`symbol`, `cmcId`
 * unique, `name`, `slug`, `logo`, `reason`/`transferSpeed` defaulting to
 * `""`, plus per exchange a boolean flag and an `<exchange>AlternateSymbol`
 * string defaulting to `""`), in Postgres `snake_case` columns — plus the
 * three tables the services need: `exchange_symbols` (per-exchange routing
 * projection), `orderbook_snapshots` (append-only ticks), and
 * `opportunities` (arbitrage results with `expired_at` for the scheduled
 * expiry job; rows are filtered by expiry, never deleted).
 *
 * Naming: Postgres columns are `snake_case`. The camelCase `upbitUsdt`
 * model field becomes the `upbit_usdt` / `upbit_usdt_alternate_symbol`
 * columns, matching the AMQP queue name `upbit_usdt`. Drizzle property keys
 * stay camelCase (`upbitUsdt`, `upbitUsdtAlternate`) so TypeScript call
 * sites read naturally.
 *
 * Rule: no `deleteMany` / `clearDB` anywhere in this package — rows are inserted or
 * upserted only. Coin activate/deactivate flows flip `active_coins.status`, never delete.
 *
 * @module
 */
import {
  boolean,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp
} from "drizzle-orm/pg-core"
import type { PgDatabase } from "drizzle-orm/pg-core/db"
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session"

/**
 * Canonical row for one listed coin, keyed by CoinMarketCap id.
 *
 * 30 listing columns for the 15 exchanges in field order, plus a `status`
 * lifecycle column (`"active"` / `"inactive"`, default `"active"`).
 * `reason` / `transferSpeed` default to `""`. The domain `ActiveCoin` nests
 * each boolean/string pair as `{ enabled, alternate }`;
 * `active-coins.ts` flattens/unflattens at the boundary and parses via domain Schemas.
 */
export const activeCoins = pgTable("active_coins", {
  cmcId: integer("cmc_id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  logo: text("logo").notNull(),
  reason: text("reason").notNull().default(""),
  transferSpeed: text("transfer_speed").notNull().default(""),
  binance: boolean("binance").notNull().default(false),
  binanceAlternate: text("binance_alternate_symbol").notNull().default(""),
  indodax: boolean("indodax").notNull().default(false),
  indodaxAlternate: text("indodax_alternate_symbol").notNull().default(""),
  huobi: boolean("huobi").notNull().default(false),
  huobiAlternate: text("huobi_alternate_symbol").notNull().default(""),
  bybit: boolean("bybit").notNull().default(false),
  bybitAlternate: text("bybit_alternate_symbol").notNull().default(""),
  okx: boolean("okx").notNull().default(false),
  okxAlternate: text("okx_alternate_symbol").notNull().default(""),
  kucoin: boolean("kucoin").notNull().default(false),
  kucoinAlternate: text("kucoin_alternate_symbol").notNull().default(""),
  mexc: boolean("mexc").notNull().default(false),
  mexcAlternate: text("mexc_alternate_symbol").notNull().default(""),
  bittime: boolean("bittime").notNull().default(false),
  bittimeAlternate: text("bittime_alternate_symbol").notNull().default(""),
  bitget: boolean("bitget").notNull().default(false),
  bitgetAlternate: text("bitget_alternate_symbol").notNull().default(""),
  gateio: boolean("gateio").notNull().default(false),
  gateioAlternate: text("gateio_alternate_symbol").notNull().default(""),
  upbit: boolean("upbit").notNull().default(false),
  upbitAlternate: text("upbit_alternate_symbol").notNull().default(""),
  upbitUsdt: boolean("upbit_usdt").notNull().default(false),
  upbitUsdtAlternate: text("upbit_usdt_alternate_symbol").notNull().default(""),
  pintu: boolean("pintu").notNull().default(false),
  pintuAlternate: text("pintu_alternate_symbol").notNull().default(""),
  reku: boolean("reku").notNull().default(false),
  rekuAlternate: text("reku_alternate_symbol").notNull().default(""),
  bitmart: boolean("bitmart").notNull().default(false),
  bitmartAlternate: text("bitmart_alternate_symbol").notNull().default(""),
  status: text("status").notNull().default("active")
})

/** Select (read) shape of an `active_coins` row. */
export type ActiveCoinRow = typeof activeCoins.$inferSelect

/** Insert (write) shape of an `active_coins` row. */
export type ActiveCoinInsert = typeof activeCoins.$inferInsert

/**
 * Per-exchange routing projection: which symbol to subscribe on each exchange.
 *
 * Denormalized from `active_coins` — `symbol` resolves the listing override (`alternate`
 * when non-empty, else the canonical coin symbol) and `enabled` mirrors the listing flag.
 * Single-writer rule: only `upsertActive` writes both tables, in one transaction, so the
 * projection never drifts. The ingest-sender reads this table to build subscriptions without
 * parsing 30 flat columns; `existsOnOther` queries it for the cross-exchange check.
 */
export const exchangeSymbols = pgTable("exchange_symbols", {
  exchange: text("exchange").notNull(),
  cmcId: integer("cmc_id").notNull(),
  symbol: text("symbol").notNull(),
  enabled: boolean("enabled").notNull().default(false)
}, (table) => [primaryKey({ columns: [table.exchange, table.cmcId] })])

/** Select (read) shape of an `exchange_symbols` row. */
export type ExchangeSymbolRow = typeof exchangeSymbols.$inferSelect

/** Insert (write) shape of an `exchange_symbols` row. */
export type ExchangeSymbolInsert = typeof exchangeSymbols.$inferInsert

/**
 * Append-only orderbook ticks, one row per coin per exchange per capture.
 *
 * Written by the ingest-receiver from normalized `{ cmcId, asks, bids }` WS payloads (see
 * domain `OrderbookTick`); read by the arbitrage engine for the stream join. Prices/amounts
 * use `numeric` in `number` mode; `0` means "missing" upstream (guards skip
 * `buyPrice != 0` rows). Rows are never updated or deleted here —
 * retention is a future scheduled job on `captured_at`.
 */
export const orderbookSnapshots = pgTable("orderbook_snapshots", {
  id: serial("id").primaryKey(),
  exchange: text("exchange").notNull(),
  cmcId: integer("cmc_id").notNull(),
  buyPrice: numeric("buy_price", { mode: "number" }).notNull(),
  sellPrice: numeric("sell_price", { mode: "number" }).notNull(),
  buyAmount: numeric("buy_amount", { mode: "number" }).notNull(),
  sellAmount: numeric("sell_amount", { mode: "number" }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
})

/** Select (read) shape of an `orderbook_snapshots` row. */
export type OrderbookSnapshotRow = typeof orderbookSnapshots.$inferSelect

/** Insert (write) shape of an `orderbook_snapshots` row. */
export type OrderbookSnapshotInsert = typeof orderbookSnapshots.$inferInsert

/**
 * Arbitrage opportunities between two exchanges for one coin.
 *
 * Written by the arbitrage engine when the spread clears its threshold
 * (`≥ 0.1%` on 2M volume); `profit_percentage` is `numeric` because the
 * engine computes it as a number (the domain keeps the `toFixed(2)` string
 * form — trailing zeros normalize on the roundtrip, numeric equality is
 * preserved). Expiry: rows carry `expired_at` and a scheduled job filters
 * them — never `deleteMany`.
 */
export const opportunities = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  buyExchange: text("buy_exchange").notNull(),
  sellExchange: text("sell_exchange").notNull(),
  cmcId: integer("cmc_id").notNull(),
  symbol: text("symbol").notNull(),
  buyPrice: numeric("buy_price", { mode: "number" }).notNull(),
  sellPrice: numeric("sell_price", { mode: "number" }).notNull(),
  buyAmount: numeric("buy_amount", { mode: "number" }).notNull(),
  sellAmount: numeric("sell_amount", { mode: "number" }).notNull(),
  profitPercentage: numeric("profit_percentage", { mode: "number" }).notNull(),
  expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }).notNull()
})

/** Select (read) shape of an `opportunities` row. */
export type OpportunityRow = typeof opportunities.$inferSelect

/** Insert (write) shape of an `opportunities` row. */
export type OpportunityInsert = typeof opportunities.$inferInsert

/**
 * Full Drizzle schema for this package (all four tables).
 *
 * Pass to the driver at the composition root, e.g. `drizzle(pool, { schema })`, and to
 * `drizzle-kit` once the root `drizzle/schema.ts` re-exports it (follow-up infra ticket —
 * migrations are out of scope for this package).
 */
export const schema = {
  activeCoins,
  exchangeSymbols,
  orderbookSnapshots,
  opportunities
}

/**
 * Driver-agnostic Drizzle database port for the repositories in this package.
 *
 * Narrow application-owned port in the coding-standards sense: repositories depend only on
 * this structural `PgDatabase` type (any driver — `node-postgres`, `postgres-js`, proxies —
 * satisfies it), never on a concrete pool or client. The composition root builds the real
 * client from `packages/config` `databaseUrl` (`Redacted` — unwrap once at the call site)
 * and injects it. `PgTransaction` extends `PgDatabase`, so repos also accept a transaction
 * handle, which is how `upsertActive` keeps its dual write atomic.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
