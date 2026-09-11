/**
 * `@rawr/coin-store/active-coins` — `active_coins` repository plus the
 * `exchange_symbols` routing projection.
 *
 * Legacy behavior ported (read-only sources): `find()` (all coins, `symbol` ascending),
 * `findOne({ symbol })`, `updateOne(..., { upsert: true })`, and `findOneAndUpdate` from
 * `~/Tools/coin-lister-service/src/repositories/active-coin.repository.js`. Deliberately
 * NOT ported: `destroy` (`findOneAndRemove`) — per `AGENTS.md`, coins deactivate via the
 * `CoinUpdated` event plus `setStatus`, never delete. There is no `deleteMany`/`clearDB` in
 * this package.
 *
 * Two deliberate departures from legacy, both documented at the call site:
 *
 * - Identity is `CmcId` (the `cmc_id` primary key), not `symbol` — symbols change, ids do
 *   not, and the domain brands `CmcId` so the two cannot be confused.
 * - `upsertActive` dual-writes `active_coins` and `exchange_symbols` in one transaction
 *   (single-writer rule, see `schema.ts`). On conflict the coin `status` is preserved — a
 *   re-PUT must not silently reactivate a deactivated coin; reactivation goes through
 *   `setStatus` so subscribers observe the `CoinUpdated` event.
 *
 * Errors are values (`Effect.fail` with domain `TaggedError`s), never `throw`. Every row
 * read from Postgres is parsed through the domain Schemas (`parseActiveCoin`) before it
 * reaches callers — parse, don't validate.
 *
 * @module
 */
import { and, asc, eq, ne } from "drizzle-orm"
import { Effect } from "effect"
import {
  ActiveCoin,
  CmcId,
  CoinNotFound,
  CoinStatus,
  Exchange,
  Exchanges,
  InvalidCoinError,
  parseActiveCoin,
  StoreUnavailable
} from "@rawr/domain"
import type { ActiveCoinRow, Db } from "./schema.js"
import { activeCoins, exchangeSymbols } from "./schema.js"

/**
 * Maps each domain `Exchange` to its flat Drizzle property keys on `activeCoins`.
 *
 * Lets the flatten/unflatten helpers loop over `Exchanges` instead of repeating 15
 * near-identical field pairs. `satisfies` keeps the map total over `Exchange` while `as
 * const` preserves literal key types for precise row indexing.
 */
const listingColumns = {
  binance: { enabled: "binance", alternate: "binanceAlternate" },
  indodax: { enabled: "indodax", alternate: "indodaxAlternate" },
  huobi: { enabled: "huobi", alternate: "huobiAlternate" },
  bybit: { enabled: "bybit", alternate: "bybitAlternate" },
  okx: { enabled: "okx", alternate: "okxAlternate" },
  kucoin: { enabled: "kucoin", alternate: "kucoinAlternate" },
  mexc: { enabled: "mexc", alternate: "mexcAlternate" },
  bittime: { enabled: "bittime", alternate: "bittimeAlternate" },
  bitget: { enabled: "bitget", alternate: "bitgetAlternate" },
  gateio: { enabled: "gateio", alternate: "gateioAlternate" },
  upbit: { enabled: "upbit", alternate: "upbitAlternate" },
  upbitUsdt: { enabled: "upbitUsdt", alternate: "upbitUsdtAlternate" },
  pintu: { enabled: "pintu", alternate: "pintuAlternate" },
  reku: { enabled: "reku", alternate: "rekuAlternate" },
  bitmart: { enabled: "bitmart", alternate: "bitmartAlternate" }
} as const satisfies Record<Exchange, { readonly enabled: keyof ActiveCoinRow; readonly alternate: keyof ActiveCoinRow }>

/** Render an unknown driver failure safely (operation + message only, never secrets). */
const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/** Build a `StoreUnavailable` carrying the operation, the coin, and the driver message. */
const toStoreUnavailable = (operation: string, cause: unknown, cmcId: CmcId): StoreUnavailable =>
  new StoreUnavailable({ message: `${operation}: postgres unavailable for cmcId ${cmcId} (${describeCause(cause)})` })

/**
 * Take the first row of a single-row query result, or fail with the given error.
 *
 * Single-row reads (`findActiveById`, upsert `returning()`, status `returning()`) share one
 * shape: `limit(1)` / `returning()` resolve to an array that must be non-empty. Naming the
 * step keeps each repository a two-`flatMap` pipeline with a single `Effect` per step (a
 * ternary returning `Effect.fail(...) | Effect<...>` does not unify under `flatMap`).
 */
const firstRowOr = <E>(rows: ReadonlyArray<ActiveCoinRow>, fail: () => E): Effect.Effect<ActiveCoinRow, E> => {
  const row = rows[0]
  return row === undefined ? Effect.fail(fail()) : Effect.succeed(row)
}

/** Resolve the tradable symbol for one exchange (alternate override wins, else canonical). */
const resolveSymbol = (coin: ActiveCoin, exchange: Exchange): string => {
  const alternate = coin[exchange].alternate
  return alternate === "" ? coin.symbol : alternate
}

/**
 * Parse one `active_coins` row into the domain `ActiveCoin`.
 *
 * Re-nests the 30 flat listing columns into per-exchange `{ enabled, alternate }` pairs
 * and decodes through `parseActiveCoin`, so a corrupt row (bad brands, empty symbol) fails
 * as `InvalidCoinError` in the `Effect` channel instead of leaking raw data to callers.
 *
 * @param row - Raw Drizzle select row from `active_coins`.
 * @returns The parsed domain coin, or `InvalidCoinError` when the row is corrupt.
 */
export const toActiveCoin = (row: ActiveCoinRow): Effect.Effect<ActiveCoin, InvalidCoinError> => {
  const listings: Record<string, { readonly enabled: boolean; readonly alternate: string }> = {}
  for (const exchange of Exchanges) {
    const keys = listingColumns[exchange]
    listings[exchange] = { enabled: row[keys.enabled], alternate: row[keys.alternate] }
  }
  return parseActiveCoin({
    symbol: row.symbol,
    cmcId: row.cmcId,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    reason: row.reason,
    transferSpeed: row.transferSpeed,
    ...listings
  })
}

/**
 * Find one coin by its CoinMarketCap id.
 *
 * Returns the coin regardless of `status` — callers distinguishing active from inactive
 * match on the `CoinUpdated` event / `setStatus`, not on lookup misses. A miss fails as
 * `CoinNotFound` (with the structured `cmcId`); driver failures fail as `StoreUnavailable`.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param cmcId - Branded CoinMarketCap id to look up.
 * @returns The parsed `ActiveCoin`, or `CoinNotFound` / `StoreUnavailable` / `InvalidCoinError`.
 */
export const findActiveById = (
  db: Db,
  cmcId: CmcId
): Effect.Effect<ActiveCoin, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.tryPromise({
    try: () => db.select().from(activeCoins).where(eq(activeCoins.cmcId, cmcId)).limit(1),
    catch: (cause) => toStoreUnavailable("findActiveById", cause, cmcId)
  }).pipe(
    Effect.flatMap((rows) =>
      firstRowOr(rows, () => new CoinNotFound({ cmcId, message: `findActiveById: no coin for cmcId ${cmcId}` }))
    ),
    Effect.flatMap(toActiveCoin)
  )

/**
 * List all active coins, `symbol` ascending (mirrors the legacy `find().sort({ symbol: 'asc' })`).
 *
 * Only rows with `status = 'active'` are returned — deactivated coins stay in the table for
 * history and reactivation, they just drop out of this listing. Every row is parsed via
 * `toActiveCoin`, so one corrupt row fails the whole listing as `InvalidCoinError` rather
 * than silently skipping.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @returns Parsed active coins ordered by symbol, or `StoreUnavailable` / `InvalidCoinError`.
 */
export const listActive = (db: Db): Effect.Effect<Array<ActiveCoin>, StoreUnavailable | InvalidCoinError> =>
  Effect.tryPromise({
    try: () =>
      db.select().from(activeCoins).where(eq(activeCoins.status, "active")).orderBy(asc(activeCoins.symbol)),
    catch: (cause) =>
      new StoreUnavailable({ message: `listActive: postgres unavailable (${describeCause(cause)})` })
  }).pipe(Effect.flatMap((rows) => Effect.forEach(rows, toActiveCoin)))

/**
 * Insert a coin or update it when `cmc_id` already exists (`onConflictDoUpdate`).
 *
 * Legacy equivalent: `updateOne({ symbol }, { $set }, { upsert: true })`, keyed here by
 * `CmcId` instead of `symbol`. The write is transactional and dual: the `active_coins` row
 * plus all 15 `exchange_symbols` projection rows (resolved symbols, mirrored flags) so the
 * projection never drifts. On conflict `status` is preserved — a re-PUT never reactivates;
 * use `setStatus` for lifecycle changes. New rows start as `"active"`.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param coin - Parsed domain coin to persist.
 * @returns The persisted coin re-read from the upserted row, or `StoreUnavailable` / `InvalidCoinError`.
 */
export const upsertActive = (
  db: Db,
  coin: ActiveCoin
): Effect.Effect<ActiveCoin, StoreUnavailable | InvalidCoinError> =>
  Effect.tryPromise({
    try: () =>
      db.transaction(async (tx) => {
        const insert = toActiveCoinInsert(coin)
        // `status` + pk stay out of the conflict `set`: a re-PUT preserves lifecycle.
        const { cmcId: _pk, status: _status, ...set } = insert
        const rows = await tx
          .insert(activeCoins)
          .values(insert)
          .onConflictDoUpdate({ target: activeCoins.cmcId, set })
          .returning()
        for (const exchange of Exchanges) {
          const symbol = resolveSymbol(coin, exchange)
          const enabled = coin[exchange].enabled
          await tx
            .insert(exchangeSymbols)
            .values({ exchange, cmcId: coin.cmcId, symbol, enabled })
            .onConflictDoUpdate({
              target: [exchangeSymbols.exchange, exchangeSymbols.cmcId],
              set: { symbol, enabled }
            })
        }
        return rows
      }),
    catch: (cause) => toStoreUnavailable("upsertActive", cause, coin.cmcId)
  }).pipe(
    Effect.flatMap((rows) =>
      firstRowOr(
        rows,
        () => new StoreUnavailable({ message: `upsertActive: postgres returned no row for cmcId ${coin.cmcId}` })
      )
    ),
    Effect.flatMap(toActiveCoin)
  )

/**
 * Flip a coin's lifecycle without deleting anything.
 *
 * `Active` sets `status = 'active'` (reason untouched); `Inactive` sets `status = 'inactive'`
 * and stores its `reason`. Publishers emit `CoinUpdated` after this resolves; subscribers
 * (ingest-sender) diff the event against running fibers. There is intentionally no delete
 * path — the legacy `destroy` (`findOneAndRemove`) is not ported.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param status - Domain lifecycle value (`CoinActive` / `CoinInactive`, carrying `cmcId`).
 * @returns The updated coin, or `CoinNotFound` / `StoreUnavailable` / `InvalidCoinError`.
 */
export const setStatus = (
  db: Db,
  status: CoinStatus
): Effect.Effect<ActiveCoin, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.tryPromise({
    try: () =>
      db
        .update(activeCoins)
        .set(status._tag === "Active" ? { status: "active" } : { status: "inactive", reason: status.reason })
        .where(eq(activeCoins.cmcId, status.cmcId))
        .returning(),
    catch: (cause) => toStoreUnavailable("setStatus", cause, status.cmcId)
  }).pipe(
    Effect.flatMap((rows) =>
      firstRowOr(
        rows,
        () => new CoinNotFound({ cmcId: status.cmcId, message: `setStatus: no coin for cmcId ${status.cmcId}` })
      )
    ),
    Effect.flatMap(toActiveCoin)
  )

/**
 * Cross-exchange check: is this coin enabled on any exchange *other* than the given one?
 *
 * Queries the `exchange_symbols` projection (`cmc_id = ? AND exchange != ? AND enabled`),
 * limited to one row — a genuine SQL existence check, not an in-memory flag scan. The
 * ingest-sender uses it before tearing down shared resources: when the last exchange for a
 * coin goes dark, cleanup runs; otherwise only the single-exchange subscription stops.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param cmcId - Branded CoinMarketCap id to check.
 * @param exchange - The exchange to exclude from the check (already parsed at the edge).
 * @returns `true` when another enabled exchange exists, else `false`; `StoreUnavailable` on driver failure.
 */
export const existsOnOther = (
  db: Db,
  cmcId: CmcId,
  exchange: Exchange
): Effect.Effect<boolean, StoreUnavailable> =>
  Effect.tryPromise({
    try: () =>
      db
        .select({ exchange: exchangeSymbols.exchange })
        .from(exchangeSymbols)
        .where(
          and(
            eq(exchangeSymbols.cmcId, cmcId),
            ne(exchangeSymbols.exchange, exchange),
            eq(exchangeSymbols.enabled, true)
          )
        )
        .limit(1),
    catch: (cause) => toStoreUnavailable("existsOnOther", cause, cmcId)
  }).pipe(Effect.map((rows) => rows.length > 0))

/**
 * Flatten a domain coin into an `active_coins` insert row.
 *
 * Inverse of `toActiveCoin`: each `{ enabled, alternate }` listing becomes its flat column
 * pair via `listingColumns`, so the 15-exchange shape stays in one place. New rows default
 * to `status: "active"`; `upsertActive` strips `status` from the conflict `set` to preserve
 * lifecycle on re-PUT.
 *
 * @param coin - Parsed domain coin to flatten.
 * @returns Drizzle insert row for `active_coins`.
 */
export const toActiveCoinInsert = (coin: ActiveCoin): typeof activeCoins.$inferInsert => {
  const flat: Record<string, boolean | string | number> = {
    cmcId: coin.cmcId,
    symbol: coin.symbol,
    name: coin.name,
    slug: coin.slug,
    logo: coin.logo,
    reason: coin.reason,
    transferSpeed: coin.transferSpeed,
    status: "active"
  }
  for (const exchange of Exchanges) {
    const keys = listingColumns[exchange]
    flat[keys.enabled] = coin[exchange].enabled
    flat[keys.alternate] = coin[exchange].alternate
  }
  // SAFETY: keys come from `listingColumns`, total over `Exchange` and checked against
  // `ActiveCoinRow` by `satisfies`; values match column types (booleans/strings/numbers).
  // `toActiveCoin` + `parseActiveCoin` validate the roundtrip on every read.
  return flat as typeof activeCoins.$inferInsert
}
