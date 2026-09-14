import { desc, eq, gt } from "drizzle-orm"
import { Effect } from "effect"
import {
  CoinNotFound,
  Exchange,
  exchangeToSlug,
  slugToExchange,
  InvalidCoinError,
  Opportunity,
  parseOpportunity,
  StoreUnavailable
} from "@rawr/domain"
import type { CmcId } from "@rawr/domain"
import { cryptocurrencies, exchanges } from "@rawr/coin-admin-api"
import type { Db } from "./schema.js"
import { exchangeOpportunities } from "./schema.js"

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

export const saveOpportunity = (
  db: Db,
  opportunity: Opportunity,
  expiredAt: Date
): Effect.Effect<void, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const profit = Number(opportunity.profitPercentage)

    if (opportunity.profitPercentage.trim() === "" || !Number.isFinite(profit)) {
      return yield* Effect.fail(
        new InvalidCoinError({
          message: `saveOpportunity: profitPercentage is not numeric (${opportunity.profitPercentage})`
        })
      )
    }

    const cryptocurrencyId = yield* resolveCryptocurrencyId(db, "saveOpportunity", opportunity.cmcId)
    const [buyExchangeId, sellExchangeId] = yield* Effect.all([
      resolveExchangeId(db, "saveOpportunity", opportunity.buyExchange),
      resolveExchangeId(db, "saveOpportunity", opportunity.sellExchange)
    ])
    yield* Effect.tryPromise({
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
  }).pipe(Effect.asVoid)

export const listOpportunities = (
  db: Db,
  options: ListOpportunitiesOptions
): Effect.Effect<Array<StoredOpportunity>, StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
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
    })

    if (rows.length === 0) {
      return []
    }

    const [coinRows, exchangeRows] = yield* Effect.all([
      Effect.tryPromise({
        try: () => db.select().from(cryptocurrencies),
        catch: (cause) =>
          new StoreUnavailable({
            message: `listOpportunities: postgres unavailable (${describeCause(cause)})`
          })
      }),
      Effect.tryPromise({
        try: () => db.select().from(exchanges),
        catch: (cause) =>
          new StoreUnavailable({
            message: `listOpportunities: postgres unavailable (${describeCause(cause)})`
          })
      })
    ])

    const cmcIdByCryptoId = new Map(coinRows.map((coin) => [coin.id, coin.cmcId] as const))
    const slugByExchangeId = new Map(exchangeRows.map((row) => [row.id, row.slug] as const))

    return yield* Effect.forEach(rows, (row) =>
      Effect.gen(function*() {
        const cmcId = cmcIdByCryptoId.get(row.cryptocurrencyId)
        const buySlug = slugByExchangeId.get(row.buyExchangeId)
        const sellSlug = slugByExchangeId.get(row.sellExchangeId)

        if (cmcId === undefined || buySlug === undefined || sellSlug === undefined) {
          return yield* Effect.fail(
            new InvalidCoinError({
              message: `listOpportunities: corrupt opportunity row (id ${row.id})`
            })
          )
        }

        const [buyExchange, sellExchange] = yield* Effect.all([
          slugToExchange(buySlug),
          slugToExchange(sellSlug)
        ])
        const opportunity = yield* parseOpportunity({
          symbol: row.symbol,
          cmcId,
          buyExchange,
          sellExchange,
          buyPrice: row.buyPrice,
          sellPrice: row.sellPrice,
          buyAmount: row.buyAmount,
          sellAmount: row.sellAmount,
          profitPercentage: String(row.profitPercentage)
        })
        return { opportunity, expiredAt: row.expiredAt }
      }))
  })
