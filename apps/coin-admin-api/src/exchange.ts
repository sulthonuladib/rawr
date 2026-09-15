import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Exchange, exchangeToSlug, InvalidCoinError, StoreUnavailable } from "@rawr/domain"
import type { DbOrTx } from "./schema.js"
import { exchanges } from "./schema.js"

export class ExchangeInfo extends Schema.Class<ExchangeInfo>("@rawr/coin-admin-api/ExchangeInfo")({
  slug: Schema.NonEmptyString,
  name: Schema.NonEmptyString
}) {}

export type ExchangeInfoEncoded = typeof ExchangeInfo["Encoded"]

export const decodeExchangeInfo = Schema.decodeUnknownEffect(ExchangeInfo)

export const encodeExchangeInfo = Schema.encodeEffect(ExchangeInfo)

export const parseExchangeInfo = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<ExchangeInfo, InvalidCoinError> =>
  decodeExchangeInfo(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const firstRowOr = <A, E>(rows: ReadonlyArray<A>, fail: () => E): Effect.Effect<A, E> => {
  const row = rows[0]

  return row === undefined ? Effect.fail(fail()) : Effect.succeed(row)
}

const toExchangeInfo = (
  row: typeof exchanges.$inferSelect
): Effect.Effect<ExchangeInfo, InvalidCoinError> =>
  parseExchangeInfo({ slug: row.slug, name: row.name })

export const listExchanges = (
  db: DbOrTx
): Effect.Effect<Array<ExchangeInfo>, StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(exchanges).orderBy(exchanges.slug),
      catch: (cause) =>
        new StoreUnavailable({ message: `listExchanges: postgres unavailable (${describeCause(cause)})` })
    })

    return yield* Effect.forEach(rows, toExchangeInfo)
  })

export const getExchange = (
  db: DbOrTx,
  exchange: Exchange
): Effect.Effect<ExchangeInfo, InvalidCoinError | StoreUnavailable> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(exchanges).where(eq(exchanges.slug, exchangeToSlug(exchange))).limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `getExchange: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(
      rows,
      () => new InvalidCoinError({ message: `getExchange: unknown exchange (${exchange})` })
    )

    return yield* toExchangeInfo(row)
  })
