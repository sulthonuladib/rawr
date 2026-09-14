import { index, integer, numeric, pgTable, timestamp } from "drizzle-orm/pg-core"
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

export type ExchangeSnapshotRow = typeof exchangeSnapshots.$inferSelect

export type ExchangeSnapshotInsert = typeof exchangeSnapshots.$inferInsert

export const schema = {
  exchangeSnapshots
}

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
