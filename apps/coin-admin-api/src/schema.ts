import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core"
import type { PgDatabase } from "drizzle-orm/pg-core/db"
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session"

export const cryptocurrencyStatusEnum = pgEnum("cryptocurrency_status", ["active", "inactive"])

export type CryptocurrencyStatusValue = (typeof cryptocurrencyStatusEnum.enumValues)[number]

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

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

export type CryptocurrencyRow = typeof cryptocurrencies.$inferSelect

export type CryptocurrencyInsert = typeof cryptocurrencies.$inferInsert

export const exchanges = pgTable("exchanges", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps()
})

export type ExchangeRow = typeof exchanges.$inferSelect

export type ExchangeInsert = typeof exchanges.$inferInsert

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

export type ExchangeCryptocurrencyRow = typeof exchangeCryptocurrencies.$inferSelect

export type ExchangeCryptocurrencyInsert = typeof exchangeCryptocurrencies.$inferInsert

export const chains = pgTable("chains", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps()
})

export type ChainRow = typeof chains.$inferSelect

export type ChainInsert = typeof chains.$inferInsert

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

export type ExchangeCryptocurrencyChainRow = typeof exchangeCryptocurrencyChains.$inferSelect

export type ExchangeCryptocurrencyChainInsert = typeof exchangeCryptocurrencyChains.$inferInsert

export const schema = {
  cryptocurrencies,
  exchanges,
  exchangeCryptocurrencies,
  chains,
  exchangeCryptocurrencyChains,
  cryptocurrencyStatusEnum
}

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
