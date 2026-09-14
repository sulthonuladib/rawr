import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { CmcId, Exchange, StoreUnavailable } from "@rawr/domain"
import { exchangeCryptocurrencies, cryptocurrencies, exchanges } from "./schema.js"
import { exchangeToSlug } from "./exchanges.js"
import { db } from "./db.js"

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const insertCrypto = (cmcId: CmcId, symbol: string): Effect.Effect<number, StoreUnavailable> =>
  Effect.tryPromise({
    try: async () => {
      await db
        .insert(cryptocurrencies)
        .values({ cmcId, symbol, name: `${symbol} Fixture`, slug: `${symbol.toLowerCase()}-fixture`, logo: "https://example.invalid/logo.png" })
        .onConflictDoNothing({ target: cryptocurrencies.cmcId })

      const rows = await db
        .select({ id: cryptocurrencies.id })
        .from(cryptocurrencies)
        .where(eq(cryptocurrencies.cmcId, cmcId))
        .limit(1)

      const row = rows[0]

      if (row === undefined) {
        throw new Error(`insertCrypto: missing row for cmcId ${cmcId}`)
      }

      return row.id
    },
    catch: (cause) =>
      new StoreUnavailable({ message: `insertCrypto: postgres unavailable (${describeCause(cause)})` })
  })

export const insertListing = (
  cryptocurrencyId: number,
  exchange: Exchange,
  enabled: boolean
): Effect.Effect<number, StoreUnavailable> =>
  Effect.tryPromise({
    try: async () => {
      const exchangeRows = await db
        .select({ id: exchanges.id })
        .from(exchanges)
        .where(eq(exchanges.slug, exchangeToSlug(exchange)))
        .limit(1)

      const exchangeRow = exchangeRows[0]

      if (exchangeRow === undefined) {
        throw new Error(`insertListing: missing exchange seed row for ${exchange}`)
      }

      await db
        .insert(exchangeCryptocurrencies)
        .values({ cryptocurrencyId, exchangeId: exchangeRow.id, enabled, alternateSymbol: "" })
        .onConflictDoNothing({ target: [exchangeCryptocurrencies.cryptocurrencyId, exchangeCryptocurrencies.exchangeId] })

      const rows = await db
        .select({ id: exchangeCryptocurrencies.id })
        .from(exchangeCryptocurrencies)
        .where(eq(exchangeCryptocurrencies.cryptocurrencyId, cryptocurrencyId))
        .limit(1)

      const row = rows[0]

      if (row === undefined) {
        throw new Error(`insertListing: missing row for cryptocurrency ${cryptocurrencyId}`)
      }

      return row.id
    },
    catch: (cause) =>
      new StoreUnavailable({ message: `insertListing: postgres unavailable (${describeCause(cause)})` })
  })
