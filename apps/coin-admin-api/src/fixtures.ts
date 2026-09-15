import { eq } from "drizzle-orm"
import type { PgDatabase } from "drizzle-orm/pg-core/db"
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session"
import { Effect } from "effect"
import { CmcId, CoinNotFound, Exchange, exchangeToSlug, InvalidCoinError, StoreUnavailable } from "@rawr/domain"
import { exchangeCryptocurrencies, cryptocurrencies, exchanges } from "./schema.js"

// Any app drizzle client can seed admin tables: the queries below reference
// admin tables explicitly, so the schema parameter stays fully generic
// (mirroring drizzle's own `TFullSchema extends Record<string, unknown>`).

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const firstRowOr = <A, E>(rows: ReadonlyArray<A>, fail: () => E): Effect.Effect<A, E> => {
  const row = rows[0]

  return row === undefined ? Effect.fail(fail()) : Effect.succeed(row)
}

export const insertCrypto = <S extends Record<string, unknown>>(
  db: PgDatabase<PgQueryResultHKT, S>,
  cmcId: CmcId,
  symbol: string
): Effect.Effect<number, CoinNotFound | StoreUnavailable> =>
  Effect.gen(function*() {
    yield* Effect.tryPromise({
      try: () =>
        db
          .insert(cryptocurrencies)
          .values({
            cmcId,
            symbol,
            name: `${symbol} Fixture`,
            slug: `${symbol.toLowerCase()}-fixture`,
            logo: "https://example.invalid/logo.png"
          })
          .onConflictDoNothing({ target: cryptocurrencies.cmcId }),
      catch: (cause) =>
        new StoreUnavailable({ message: `insertCrypto: postgres unavailable (${describeCause(cause)})` })
    })

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: cryptocurrencies.id })
          .from(cryptocurrencies)
          .where(eq(cryptocurrencies.cmcId, cmcId))
          .limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `insertCrypto: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(
      rows,
      () => new CoinNotFound({ cmcId, message: `insertCrypto: missing row for cmcId ${cmcId}` })
    )

    return row.id
  })

export const insertListing = <S extends Record<string, unknown>>(
  db: PgDatabase<PgQueryResultHKT, S>,
  cryptocurrencyId: number,
  exchange: Exchange,
  enabled: boolean
): Effect.Effect<number, InvalidCoinError | StoreUnavailable> =>
  Effect.gen(function*() {
    const exchangeRows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: exchanges.id })
          .from(exchanges)
          .where(eq(exchanges.slug, exchangeToSlug(exchange)))
          .limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `insertListing: postgres unavailable (${describeCause(cause)})` })
    })

    const exchangeRow = yield* firstRowOr(
      exchangeRows,
      () => new InvalidCoinError({ message: `insertListing: missing exchange seed row for ${exchange}` })
    )

    yield* Effect.tryPromise({
      try: () =>
        db
          .insert(exchangeCryptocurrencies)
          .values({ cryptocurrencyId, exchangeId: exchangeRow.id, enabled, alternateSymbol: "" })
          .onConflictDoNothing({
            target: [exchangeCryptocurrencies.cryptocurrencyId, exchangeCryptocurrencies.exchangeId]
          }),
      catch: (cause) =>
        new StoreUnavailable({ message: `insertListing: postgres unavailable (${describeCause(cause)})` })
    })

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: exchangeCryptocurrencies.id })
          .from(exchangeCryptocurrencies)
          .where(eq(exchangeCryptocurrencies.cryptocurrencyId, cryptocurrencyId))
          .limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `insertListing: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(
      rows,
      () => new StoreUnavailable({ message: `insertListing: postgres returned no row` })
    )

    return row.id
  })
