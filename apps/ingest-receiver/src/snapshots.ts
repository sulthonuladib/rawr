import { eq } from "drizzle-orm"
import { Effect } from "effect"
import {
  CoinNotFound,
  Exchange,
  exchangeToSlug,
  OrderbookTick,
  StoreUnavailable
} from "@rawr/domain"
import type { CmcId } from "@rawr/domain"
import { cryptocurrencies, exchanges } from "@rawr/coin-admin-api"
import type { Db } from "./schema.js"
import { exchangeSnapshots } from "./schema.js"

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const firstRowOr = <A, E>(rows: ReadonlyArray<A>, fail: () => E): Effect.Effect<A, E> => {
  const row = rows[0]

  return row === undefined ? Effect.fail(fail()) : Effect.succeed(row)
}

const resolveCryptocurrencyId = (
  db: Db,
  operation: string,
  cmcId: CmcId
): Effect.Effect<number, CoinNotFound | StoreUnavailable> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () => db.select({ id: cryptocurrencies.id }).from(cryptocurrencies).where(eq(cryptocurrencies.cmcId, cmcId)).limit(1),
      catch: (cause) =>
        new StoreUnavailable({
          message: `${operation}: postgres unavailable for cmcId ${cmcId} (${describeCause(cause)})`
        })
    })

    const row = yield* firstRowOr(rows, () => new CoinNotFound({ cmcId, message: `${operation}: no coin for cmcId ${cmcId}` }))

    return row.id
  })

const resolveExchangeId = (
  db: Db,
  operation: string,
  exchange: Exchange
): Effect.Effect<number, StoreUnavailable> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.select({ id: exchanges.id }).from(exchanges).where(eq(exchanges.slug, exchangeToSlug(exchange))).limit(1),
      catch: (cause) =>
        new StoreUnavailable({
          message: `${operation}: postgres unavailable for exchange ${exchange} (${describeCause(cause)})`
        })
    })

    const row = yield* firstRowOr(
      rows,
      () => new StoreUnavailable({ message: `${operation}: missing exchange seed row for ${exchange}` })
    )

    return row.id
  })

export const saveSnapshot = (
  db: Db,
  tick: OrderbookTick,
  capturedAt: Date
): Effect.Effect<void, CoinNotFound | StoreUnavailable> =>
  Effect.gen(function*() {
    const cryptocurrencyId = yield* resolveCryptocurrencyId(db, "saveSnapshot", tick.cmcId)
    const exchangeId = yield* resolveExchangeId(db, "saveSnapshot", tick.exchange)
    yield* Effect.tryPromise({
      try: () =>
        db.insert(exchangeSnapshots).values({
          cryptocurrencyId,
          exchangeId,
          buyPrice: tick.buyPrice,
          sellPrice: tick.sellPrice,
          buyAmount: tick.buyAmount,
          sellAmount: tick.sellAmount,
          capturedAt
        }),
      catch: (cause) =>
        new StoreUnavailable({
          message: `saveSnapshot: postgres unavailable for cmcId ${tick.cmcId} on ${tick.exchange} (${describeCause(cause)})`
        })
    })
  }).pipe(Effect.asVoid)
