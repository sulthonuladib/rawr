import { desc, eq, gt } from "drizzle-orm"
import { Effect } from "effect"
import {
  CoinNotFound,
  Exchange,
  InvalidCoinError,
  Opportunity,
  OrderbookTick,
  parseOpportunity,
  StoreUnavailable
} from "@rawr/domain"
import type { CmcId } from "@rawr/domain"
import type { Db } from "./schema.js"
import { cryptocurrencies, exchanges, exchangeOpportunities, exchangeSnapshots } from "./schema.js"
import { exchangeToSlug, slugToExchange } from "./exchanges.js"

export interface StoredOpportunity {
  readonly opportunity: Opportunity
  readonly expiredAt: Date
}

export interface ListOpportunitiesOptions {
  readonly limit: number
  readonly now: Date
}

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
  Effect.tryPromise({
    try: () => db.select({ id: cryptocurrencies.id }).from(cryptocurrencies).where(eq(cryptocurrencies.cmcId, cmcId)).limit(1),
    catch: (cause) =>
      new StoreUnavailable({
        message: `${operation}: postgres unavailable for cmcId ${cmcId} (${describeCause(cause)})`
      })
  }).pipe(
    Effect.flatMap((rows) =>
      firstRowOr(rows, () => new CoinNotFound({ cmcId, message: `${operation}: no coin for cmcId ${cmcId}` }))
    ),
    Effect.map((row) => row.id)
  )

const resolveExchangeId = (
  db: Db,
  operation: string,
  exchange: Exchange
): Effect.Effect<number, StoreUnavailable> =>
  Effect.tryPromise({
    try: () =>
      db.select({ id: exchanges.id }).from(exchanges).where(eq(exchanges.slug, exchangeToSlug(exchange))).limit(1),
    catch: (cause) =>
      new StoreUnavailable({
        message: `${operation}: postgres unavailable for exchange ${exchange} (${describeCause(cause)})`
      })
  }).pipe(
    Effect.flatMap((rows) =>
      firstRowOr(
        rows,
        () => new StoreUnavailable({ message: `${operation}: missing exchange seed row for ${exchange}` })
      )
    ),
    Effect.map((row) => row.id)
  )

export const saveSnapshot = (
  db: Db,
  tick: OrderbookTick,
  capturedAt: Date
): Effect.Effect<void, CoinNotFound | StoreUnavailable> =>
  resolveCryptocurrencyId(db, "saveSnapshot", tick.cmcId).pipe(
    Effect.flatMap((cryptocurrencyId) =>
      resolveExchangeId(db, "saveSnapshot", tick.exchange).pipe(
        Effect.flatMap((exchangeId) =>
          Effect.tryPromise({
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
        )
      )
    ),
    Effect.asVoid
  )

export const saveOpportunity = (
  db: Db,
  opportunity: Opportunity,
  expiredAt: Date
): Effect.Effect<void, CoinNotFound | StoreUnavailable | InvalidCoinError> => {
  const profit = Number(opportunity.profitPercentage)

  if (opportunity.profitPercentage.trim() === "" || !Number.isFinite(profit)) {
    return Effect.fail(
      new InvalidCoinError({
        message: `saveOpportunity: profitPercentage is not numeric (${opportunity.profitPercentage})`
      })
    )
  }

  return resolveCryptocurrencyId(db, "saveOpportunity", opportunity.cmcId).pipe(
    Effect.flatMap((cryptocurrencyId) =>
      resolveExchangeId(db, "saveOpportunity", opportunity.buyExchange).pipe(
        Effect.flatMap((buyExchangeId) =>
          resolveExchangeId(db, "saveOpportunity", opportunity.sellExchange).pipe(
            Effect.flatMap((sellExchangeId) =>
              Effect.tryPromise({
                try: () =>
                  db.insert(exchangeOpportunities).values({
                    cryptocurrencyId,
                    buyExchangeId,
                    sellExchangeId,
                    symbol: opportunity.symbol,
                    buyPrice: opportunity.buyPrice,
                    sellPrice: opportunity.sellPrice,
                    buyAmount: opportunity.buyAmount,
                    sellAmount: opportunity.sellAmount,
                    profitPercentage: profit,
                    expiredAt
                  }),
                catch: (cause) =>
                  new StoreUnavailable({
                    message: `saveOpportunity: postgres unavailable for cmcId ${opportunity.cmcId} (${describeCause(cause)})`
                  })
              })
            )
          )
        )
      )
    ),
    Effect.asVoid
  )
}

export const listOpportunities = (
  db: Db,
  options: ListOpportunitiesOptions
): Effect.Effect<Array<StoredOpportunity>, StoreUnavailable | InvalidCoinError> =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(exchangeOpportunities)
        .where(gt(exchangeOpportunities.expiredAt, options.now))
        .orderBy(desc(exchangeOpportunities.profitPercentage))
        .limit(options.limit),
    catch: (cause) =>
      new StoreUnavailable({
        message: `listOpportunities: postgres unavailable (${describeCause(cause)})`
      })
  }).pipe(
    Effect.flatMap((rows) => {
      if (rows.length === 0) {
        return Effect.succeed<Array<StoredOpportunity>>([])
      }

      return Effect.tryPromise({
        try: () => db.select().from(cryptocurrencies),
        catch: (cause) =>
          new StoreUnavailable({
            message: `listOpportunities: postgres unavailable (${describeCause(cause)})`
          })
      }).pipe(
        Effect.flatMap((coinRows) =>
          Effect.tryPromise({
            try: () => db.select().from(exchanges),
            catch: (cause) =>
              new StoreUnavailable({
                message: `listOpportunities: postgres unavailable (${describeCause(cause)})`
              })
          }).pipe(
            Effect.flatMap((exchangeRows) => {
              const cmcIdByCryptoId = new Map(coinRows.map((coin) => [coin.id, coin.cmcId] as const))
              const slugByExchangeId = new Map(exchangeRows.map((row) => [row.id, row.slug] as const))

              return Effect.forEach(rows, (row) => {
                const cmcId = cmcIdByCryptoId.get(row.cryptocurrencyId)
                const buySlug = slugByExchangeId.get(row.buyExchangeId)
                const sellSlug = slugByExchangeId.get(row.sellExchangeId)

                if (cmcId === undefined || buySlug === undefined || sellSlug === undefined) {
                  return Effect.fail(
                    new InvalidCoinError({
                      message: `listOpportunities: corrupt opportunity row (id ${row.id})`
                    })
                  )
                }

                return slugToExchange(buySlug).pipe(
                  Effect.flatMap((buyExchange) =>
                    slugToExchange(sellSlug).pipe(
                      Effect.flatMap((sellExchange) =>
                        parseOpportunity({
                          symbol: row.symbol,
                          cmcId,
                          buyExchange,
                          sellExchange,
                          buyPrice: row.buyPrice,
                          sellPrice: row.sellPrice,
                          buyAmount: row.buyAmount,
                          sellAmount: row.sellAmount,
                          profitPercentage: String(row.profitPercentage)
                        }).pipe(
                          Effect.map((opportunity): StoredOpportunity => ({ opportunity, expiredAt: row.expiredAt }))
                        )
                      )
                    )
                  )
                )
              })
            })
          )
        )
      )
    })
  )
