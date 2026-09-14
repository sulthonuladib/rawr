import { index, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import type { PgDatabase } from "drizzle-orm/pg-core/db"
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session"
import { cryptocurrencies, exchanges } from "@rawr/coin-admin-api"

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

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

export type ExchangeOpportunityRow = typeof exchangeOpportunities.$inferSelect

export type ExchangeOpportunityInsert = typeof exchangeOpportunities.$inferInsert

export const schema = {
  exchangeOpportunities
}

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
