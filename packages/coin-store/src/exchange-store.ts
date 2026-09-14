/**
 * `@rawr/coin-store/exchange-store` — `exchange_snapshots` and
 * `exchange_opportunities` repositories (FK-backed into the listing graph).
 *
 * Orderbook rows per exchange (`cryptocurrency_id` + `exchange_id` FKs,
 * prices/amounts, `captured_at`) and arbitrage results (`cryptocurrency_id` +
 * buy/sell exchange FKs, prices + amounts, `profitPercentage` in `toFixed(2)`
 * string form).
 *
 * Three boundary notes:
 *
 * - Writes resolve domain identity (`cmcId` → `cryptocurrencies.id`,
 *   `Exchange` → `exchanges.id` via the `upbitUsdt`/`upbit_usdt` slug mapping)
 *   before inserting, so a missing coin fails as `CoinNotFound` instead of a
 *   raw FK violation. A missing exchange seed row fails as `StoreUnavailable`
 *   (infra, not input).
 * - `profitPercentage` is `numeric` in Postgres but a `String` in the domain (wire
 *   format). The write path rejects non-numeric strings as `InvalidCoinError`; the read path
 *   stringifies the number, so trailing zeros normalize (`"0.40"` → `"0.4"`) while numeric
 *   equality is preserved.
 * - `listOpportunities` returns only unexpired rows (`expired_at > now`, most profitable
 *   first) — callers pass `now` explicitly so reads stay deterministic through real seams.
 *   Expiry is a scheduled job on `expired_at`, never `deleteMany`. Corrupt rows
 *   (bad brands, unknown slugs) fail as `InvalidCoinError`, never raw data.
 *
 * Errors are values (`Effect.fail` with domain `TaggedError`s), never `throw`.
 *
 * @module
 */
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

/**
 * A persisted arbitrage opportunity: the domain value plus its expiry.
 *
 * The domain `Opportunity` carries no expiry (it is a pure detection result); the store
 * pairs it with `expired_at` at the boundary so services can filter and schedule without
 * inventing a second shape.
 */
export interface StoredOpportunity {
  /** The parsed domain opportunity (exchanges, prices, amounts, profit). */
  readonly opportunity: Opportunity
  /** When this opportunity expires (rows at or past `now` are filtered by readers). */
  readonly expiredAt: Date
}

/**
 * Options for `listOpportunities` — both fields required (no `Partial`, no optionality
 * pushed into the query builder).
 */
export interface ListOpportunitiesOptions {
  /** Maximum rows to return (most profitable first). */
  readonly limit: number
  /** Reference time: only rows with `expired_at` after `now` are returned. */
  readonly now: Date
}

/** Render an unknown driver failure safely (operation + message only, never secrets). */
const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/**
 * Take the first row of a single-row query result, or fail with the given error.
 *
 * Naming the step keeps each repository a two-`flatMap` pipeline: a ternary
 * returning `Effect.fail(...) | Effect.succeed(...)` does not unify under
 * `flatMap`, so the branches fuse through this helper's explicit `E` instead.
 */
const firstRowOr = <A, E>(rows: ReadonlyArray<A>, fail: () => E): Effect.Effect<A, E> => {
  const row = rows[0]

  return row === undefined ? Effect.fail(fail()) : Effect.succeed(row)
}

/**
 * Resolve a cryptocurrency id from its domain `cmcId`.
 *
 * @returns the surrogate `cryptocurrencies.id`, or `CoinNotFound` when no row exists.
 */
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

/**
 * Resolve an exchange id from its domain value.
 *
 * The domain value maps to the DB slug (`upbitUsdt` → `upbit_usdt`); a missing
 * seed row is infra failure (`StoreUnavailable`), never input failure — the
 * value already parsed at the edge.
 */
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

/**
 * Append one normalized orderbook tick for a coin on an exchange.
 *
 * The ingest-receiver calls this per normalized `{ cmcId, asks, bids }` payload. Snapshots
 * are append-only: no upsert, no update, no delete — retention is a future scheduled job on
 * `captured_at`. `0` prices/amounts mean "missing" upstream (guards skip `buyPrice != 0` rows).
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param tick - Parsed domain tick (exchange, coin, prices, amounts).
 * @param capturedAt - Capture time, passed explicitly for deterministic tests.
 * @returns `void` on success, or `CoinNotFound` / `StoreUnavailable` on failure.
 */
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

/**
 * Persist one arbitrage opportunity with its expiry.
 *
 * The arbitrage engine calls this when the spread clears its threshold. Guards the
 * string→`numeric` boundary: a non-numeric `profitPercentage` fails as `InvalidCoinError`
 * instead of reaching Postgres as `NaN`. Missing coin rows fail as `CoinNotFound`.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param opportunity - Parsed domain opportunity (`toFixed(2)` profit format).
 * @param expiredAt - When this opportunity expires (drives reader filtering + the expiry job).
 * @returns `void` on success, or `CoinNotFound` / `StoreUnavailable` / `InvalidCoinError`.
 */
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

/**
 * List live arbitrage opportunities, most profitable first.
 *
 * Returns only rows with `expired_at` later than `options.now`, ordered by
 * `profit_percentage` descending, capped at `options.limit`. Cryptocurrency and
 * exchange ids resolve back through batched lookups (`cryptocurrencies` for
 * `cmcId`, `exchanges` for slugs → domain `Exchange`); each row is parsed through
 * `parseOpportunity`, so a corrupt row fails as `InvalidCoinError` instead of
 * reaching the signal path.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param options - Required `limit` plus explicit `now` for deterministic reads.
 * @returns Live opportunities paired with expiry, or `StoreUnavailable` / `InvalidCoinError`.
 */
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
        return Effect.succeed([] as Array<StoredOpportunity>)
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
