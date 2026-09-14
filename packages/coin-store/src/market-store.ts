/**
 * `@rawr/coin-store/market-store` — `orderbook_snapshots` and `opportunities` repositories.
 *
 * Orderbook rows per exchange (`cmcId`, `buyPrice`/`sellPrice`,
 * `buyAmount`/`sellAmount`, updated from `{ cmcId, asks, bids }` WS payloads)
 * and arbitrage results (buy/sell prices + amounts, buy/sell exchanges,
 * `profitPercentage` in `toFixed(2)` string form).
 *
 * Two boundary notes:
 *
 * - `profitPercentage` is `numeric` in Postgres but a `String` in the domain (wire
 *   format). The write path rejects non-numeric strings as `InvalidCoinError`; the read path
 *   stringifies the number, so trailing zeros normalize (`"0.40"` → `"0.4"`) while numeric
 *   equality is preserved.
 * - `listOpportunities` returns only unexpired rows (`expired_at > now`, most profitable
 *   first) — callers pass `now` explicitly so reads stay deterministic through real seams.
 *   Expiry is a scheduled job on `expired_at`, never `deleteMany`.
 *
 * Errors are values (`Effect.fail` with domain `TaggedError`s), never `throw`.
 *
 * @module
 */
import { desc, gt } from "drizzle-orm"
import { Effect } from "effect"
import {
  InvalidCoinError,
  Opportunity,
  OrderbookTick,
  parseOpportunity,
  StoreUnavailable
} from "@rawr/domain"
import type { Db } from "./schema.js"
import { opportunities, orderbookSnapshots } from "./schema.js"

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
 * @returns `void` on success, or `StoreUnavailable` on driver failure.
 */
export const saveSnapshot = (
  db: Db,
  tick: OrderbookTick,
  capturedAt: Date
): Effect.Effect<void, StoreUnavailable> =>
  Effect.tryPromise({
    try: () =>
      db.insert(orderbookSnapshots).values({
        exchange: tick.exchange,
        cmcId: tick.cmcId,
        buyPrice: tick.buyPrice,
        sellPrice: tick.sellPrice,
        buyAmount: tick.buyAmount,
        sellAmount: tick.sellAmount,
        capturedAt
      }),
    catch: (cause) =>
      new StoreUnavailable({
        message: `saveSnapshot: postgres unavailable for cmcId ${tick.cmcId} on ${tick.exchange} (${
          cause instanceof Error ? cause.message : String(cause)
        })`
      })
  }).pipe(Effect.asVoid)

/**
 * Persist one arbitrage opportunity with its expiry.
 *
 * The arbitrage engine calls this when the spread clears its threshold. Guards the
 * string→`numeric` boundary: a non-numeric `profitPercentage` fails as `InvalidCoinError`
 * instead of reaching Postgres as `NaN`.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param opportunity - Parsed domain opportunity (`toFixed(2)` profit format).
 * @param expiredAt - When this opportunity expires (drives reader filtering + the expiry job).
 * @returns `void` on success, or `StoreUnavailable` / `InvalidCoinError`.
 */
export const saveOpportunity = (
  db: Db,
  opportunity: Opportunity,
  expiredAt: Date
): Effect.Effect<void, StoreUnavailable | InvalidCoinError> => {
  const profit = Number(opportunity.profitPercentage)

  return opportunity.profitPercentage.trim() === "" || !Number.isFinite(profit)
    ? Effect.fail(
      new InvalidCoinError({
        message: `saveOpportunity: profitPercentage is not numeric (${opportunity.profitPercentage})`
      })
    )
    : Effect.tryPromise({
      try: () =>
        db.insert(opportunities).values({
          buyExchange: opportunity.buyExchange,
          sellExchange: opportunity.sellExchange,
          cmcId: opportunity.cmcId,
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
          message: `saveOpportunity: postgres unavailable for cmcId ${opportunity.cmcId} (${
            cause instanceof Error ? cause.message : String(cause)
          })`
        })
    }).pipe(Effect.asVoid)
}

/**
 * List live arbitrage opportunities, most profitable first.
 *
 * Returns only rows with `expired_at` later than `options.now`, ordered by
 * `profit_percentage` descending, capped at `options.limit`. Each row is parsed through
 * `parseOpportunity`, so a corrupt row fails as `InvalidCoinError` instead of reaching the
 * signal path.
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
        .from(opportunities)
        .where(gt(opportunities.expiredAt, options.now))
        .orderBy(desc(opportunities.profitPercentage))
        .limit(options.limit),
    catch: (cause) =>
      new StoreUnavailable({
        message: `listOpportunities: postgres unavailable (${cause instanceof Error ? cause.message : String(cause)})`
      })
  }).pipe(
    Effect.flatMap((rows) =>
      Effect.forEach(rows, (row) =>
        parseOpportunity({
          symbol: row.symbol,
          cmcId: row.cmcId,
          buyExchange: row.buyExchange,
          sellExchange: row.sellExchange,
          buyPrice: row.buyPrice,
          sellPrice: row.sellPrice,
          buyAmount: row.buyAmount,
          sellAmount: row.sellAmount,
          profitPercentage: String(row.profitPercentage)
        }).pipe(Effect.map((opportunity): StoredOpportunity => ({ opportunity, expiredAt: row.expiredAt })))
      )
    )
  )
