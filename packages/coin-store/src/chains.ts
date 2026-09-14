/**
 * `@rawr/coin-store/chains` — `chains` registry and
 * `exchange_cryptocurrency_chain` per-listing transfer flags, plus the derived
 * transfer-speed reader.
 *
 * - `upsertChain` / `listChains`: chain CRUD (upsert by `code`, update `name`).
 * - `upsertListingChain` / `updateListingChainFlags` / `listListingChains`:
 *   per-listing capabilities (exchange code/name overrides, withdraw/deposit
 *   flags) resolved through the listing graph (`cmcId` + `Exchange` →
 *   `exchange_cryptocurrency.id`, `chainCode` → `chains.id`).
 * - `getTransferSpeed`: derived transfer speed for one listing — computed from
 *   its chain rows at read time via the domain `deriveTransferSpeed` pure
 *   function (no cached string is ever stored).
 *
 * Errors are values (`Effect.fail` with domain `TaggedError`s), never `throw`.
 * Every row is parsed through the domain Schemas before it reaches callers.
 *
 * @module
 */
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import {
  Chain,
  CmcId,
  CoinNotFound,
  deriveTransferSpeed,
  Exchange,
  InvalidCoinError,
  ListingChain,
  parseChain,
  parseListingChain,
  StoreUnavailable,
  TransferSpeed
} from "@rawr/domain"
import type { Db } from "./schema.js"
import {
  chains,
  cryptocurrencies,
  exchangeCryptocurrencies,
  exchangeCryptocurrencyChains,
  exchanges
} from "./schema.js"
import { exchangeToSlug } from "./exchanges.js"

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
 * Input for `upsertListingChain` / `updateListingChainFlags` — identifies one
 * (listing, chain) pair plus its transfer facts.
 */
export interface ListingChainInput {
  /** Branded CoinMarketCap id (resolves to the coin, then the listing). */
  readonly cmcId: CmcId
  /** Domain exchange (maps to the DB slug at the boundary). */
  readonly exchange: Exchange
  /** Canonical chain code (must already exist in `chains`). */
  readonly chainCode: string
  /** The exchange's spelling of the chain code. */
  readonly exchangeChainCode: string
  /** Optional exchange spelling of the chain name (`""` = no override). */
  readonly exchangeChainName: string
  /** Whether withdrawals are enabled on this listing+chain. */
  readonly withdrawEnabled: boolean
  /** Whether deposits are enabled on this listing+chain. */
  readonly depositEnabled: boolean
}

/**
 * Parse one `chains` row into the domain `Chain`.
 */
const toChain = (row: { readonly code: string; readonly name: string }): Effect.Effect<Chain, InvalidCoinError> =>
  parseChain({ code: row.code, name: row.name })

/**
 * Parse one `exchange_cryptocurrency_chain` row into the domain `ListingChain`.
 *
 * `exchange_chain_name` is nullable in Postgres (`null` = no override) and
 * normalizes to `""` in the domain (avoiding `exactOptionalPropertyTypes`
 * friction).
 */
const toListingChain = (row: {
  readonly chainCode: string
  readonly exchangeChainCode: string
  readonly exchangeChainName: string | null
  readonly withdrawEnabled: boolean
  readonly depositEnabled: boolean
}): Effect.Effect<ListingChain, InvalidCoinError> =>
  parseListingChain({
    chainCode: row.chainCode,
    exchangeChainCode: row.exchangeChainCode,
    exchangeChainName: row.exchangeChainName ?? "",
    withdrawEnabled: row.withdrawEnabled,
    depositEnabled: row.depositEnabled
  })

/**
 * Resolve a listing id from its domain identity (`cmcId` + `Exchange`).
 *
 * @returns the surrogate `exchange_cryptocurrency.id`, or `CoinNotFound` when
 * the coin or its listing on that exchange does not exist.
 */
const resolveListingId = (
  db: Db,
  operation: string,
  cmcId: CmcId,
  exchange: Exchange
): Effect.Effect<number, CoinNotFound | StoreUnavailable> =>
  Effect.tryPromise({
    try: () =>
      db
        .select({ id: exchangeCryptocurrencies.id })
        .from(exchangeCryptocurrencies)
        .innerJoin(cryptocurrencies, eq(exchangeCryptocurrencies.cryptocurrencyId, cryptocurrencies.id))
        .innerJoin(exchanges, eq(exchangeCryptocurrencies.exchangeId, exchanges.id))
        .where(and(eq(cryptocurrencies.cmcId, cmcId), eq(exchanges.slug, exchangeToSlug(exchange))))
        .limit(1),
    catch: (cause) =>
      new StoreUnavailable({
        message: `${operation}: postgres unavailable for cmcId ${cmcId} on ${exchange} (${describeCause(cause)})`
      })
  }).pipe(
    Effect.flatMap((rows) =>
      firstRowOr(
        rows,
        () => new CoinNotFound({ cmcId, message: `${operation}: no listing for cmcId ${cmcId} on ${exchange}` })
      )
    ),
    Effect.map((row) => row.id)
  )

/**
 * Resolve a chain id from its canonical code.
 *
 * @returns the surrogate `chains.id`, or `InvalidCoinError` when the code is
 * unknown (upsert the chain first).
 */
const resolveChainId = (
  db: Db,
  operation: string,
  chainCode: string
): Effect.Effect<number, InvalidCoinError | StoreUnavailable> =>
  Effect.tryPromise({
    try: () => db.select({ id: chains.id }).from(chains).where(eq(chains.code, chainCode)).limit(1),
    catch: (cause) =>
      new StoreUnavailable({ message: `${operation}: postgres unavailable (${describeCause(cause)})` })
  }).pipe(
    Effect.flatMap((rows) =>
      firstRowOr(rows, () => new InvalidCoinError({ message: `${operation}: unknown chain code (${chainCode})` }))
    ),
    Effect.map((row) => row.id)
  )

/**
 * Insert a chain or update its name when `code` already exists.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param chain - Parsed domain chain to persist.
 * @returns The persisted chain, or `StoreUnavailable` / `InvalidCoinError`.
 */
export const upsertChain = (
  db: Db,
  chain: Chain
): Effect.Effect<Chain, StoreUnavailable | InvalidCoinError> =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(chains)
        .values({ code: chain.code, name: chain.name })
        .onConflictDoUpdate({
          target: chains.code,
          set: { name: chain.name, updatedAt: new Date() }
        })
        .returning(),
    catch: (cause) =>
      new StoreUnavailable({ message: `upsertChain: postgres unavailable (${describeCause(cause)})` })
  }).pipe(
    Effect.flatMap((rows) =>
      firstRowOr(rows, () => new StoreUnavailable({ message: `upsertChain: postgres returned no row` })).pipe(
        Effect.flatMap(toChain)
      )
    )
  )

/**
 * List all chains, `code` ascending.
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @returns Parsed chains, or `StoreUnavailable` / `InvalidCoinError`.
 */
export const listChains = (db: Db): Effect.Effect<Array<Chain>, StoreUnavailable | InvalidCoinError> =>
  Effect.tryPromise({
    try: () => db.select().from(chains).orderBy(chains.code),
    catch: (cause) =>
      new StoreUnavailable({ message: `listChains: postgres unavailable (${describeCause(cause)})` })
  }).pipe(Effect.flatMap((rows) => Effect.forEach(rows, toChain)))

/**
 * Insert or update one (listing, chain) capability row.
 *
 * Resolves the listing (`cmcId` + `Exchange`) and the chain (`chainCode`),
 * then upserts the flags plus the exchange code/name overrides. Missing
 * listings fail as `CoinNotFound`; unknown chain codes fail as
 * `InvalidCoinError` (upsert the chain first).
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param input - The (listing, chain) pair plus its transfer facts.
 * @returns The persisted `ListingChain`, or `CoinNotFound` / `StoreUnavailable` / `InvalidCoinError`.
 */
export const upsertListingChain = (
  db: Db,
  input: ListingChainInput
): Effect.Effect<ListingChain, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  resolveListingId(db, "upsertListingChain", input.cmcId, input.exchange).pipe(
    Effect.flatMap((listingId) =>
      resolveChainId(db, "upsertListingChain", input.chainCode).pipe(
        Effect.flatMap((chainId) =>
          Effect.tryPromise({
            try: () =>
              db
                .insert(exchangeCryptocurrencyChains)
                .values({
                  exchangeCryptocurrencyId: listingId,
                  chainId,
                  exchangeChainCode: input.exchangeChainCode,
                  exchangeChainName: input.exchangeChainName === "" ? null : input.exchangeChainName,
                  withdrawEnabled: input.withdrawEnabled,
                  depositEnabled: input.depositEnabled
                })
                .onConflictDoUpdate({
                  target: [
                    exchangeCryptocurrencyChains.exchangeCryptocurrencyId,
                    exchangeCryptocurrencyChains.chainId
                  ],
                  set: {
                    exchangeChainCode: input.exchangeChainCode,
                    exchangeChainName: input.exchangeChainName === "" ? null : input.exchangeChainName,
                    withdrawEnabled: input.withdrawEnabled,
                    depositEnabled: input.depositEnabled,
                    updatedAt: new Date()
                  }
                })
                .returning(),
            catch: (cause) =>
              new StoreUnavailable({ message: `upsertListingChain: postgres unavailable (${describeCause(cause)})` })
          }).pipe(
            Effect.flatMap((rows) =>
              firstRowOr(
                rows,
                () => new StoreUnavailable({ message: `upsertListingChain: postgres returned no row` })
              ).pipe(
                Effect.flatMap((row) =>
                  toListingChain({
                    chainCode: input.chainCode,
                    exchangeChainCode: row.exchangeChainCode,
                    exchangeChainName: row.exchangeChainName,
                    withdrawEnabled: row.withdrawEnabled,
                    depositEnabled: row.depositEnabled
                  })
                )
              )
            )
          )
        )
      )
    )
  )

/**
 * Update withdraw/deposit flags for one (listing, chain) row.
 *
 * Code/name overrides are untouched — use `upsertListingChain` to change them.
 * A miss fails as `CoinNotFound` (unknown listing) or `InvalidCoinError`
 * (unknown chain code / missing row).
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param input - The (listing, chain) pair plus the new flags (code/name
 * fields are used only for resolution, not updated).
 * @returns The updated `ListingChain`, or `CoinNotFound` / `StoreUnavailable` / `InvalidCoinError`.
 */
export const updateListingChainFlags = (
  db: Db,
  input: ListingChainInput
): Effect.Effect<ListingChain, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  resolveListingId(db, "updateListingChainFlags", input.cmcId, input.exchange).pipe(
    Effect.flatMap((listingId) =>
      resolveChainId(db, "updateListingChainFlags", input.chainCode).pipe(
        Effect.flatMap((chainId) =>
          Effect.tryPromise({
            try: () =>
              db
                .update(exchangeCryptocurrencyChains)
                .set({
                  withdrawEnabled: input.withdrawEnabled,
                  depositEnabled: input.depositEnabled,
                  updatedAt: new Date()
                })
                .where(
                  and(
                    eq(exchangeCryptocurrencyChains.exchangeCryptocurrencyId, listingId),
                    eq(exchangeCryptocurrencyChains.chainId, chainId)
                  )
                )
                .returning(),
            catch: (cause) =>
              new StoreUnavailable({
                message: `updateListingChainFlags: postgres unavailable (${describeCause(cause)})`
              })
          }).pipe(
            Effect.flatMap((rows) =>
              firstRowOr(
                rows,
                () =>
                  new InvalidCoinError({
                    message: `updateListingChainFlags: no row for cmcId ${input.cmcId} on ${input.exchange} chain ${input.chainCode}`
                  })
              ).pipe(
                Effect.flatMap((row) =>
                  toListingChain({
                    chainCode: input.chainCode,
                    exchangeChainCode: row.exchangeChainCode,
                    exchangeChainName: row.exchangeChainName,
                    withdrawEnabled: row.withdrawEnabled,
                    depositEnabled: row.depositEnabled
                  })
                )
              )
            )
          )
        )
      )
    )
  )

/**
 * List one listing's chain rows (each with its canonical code).
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param cmcId - Branded CoinMarketCap id.
 * @param exchange - Domain exchange.
 * @returns Parsed `ListingChain` rows, or `CoinNotFound` / `StoreUnavailable` / `InvalidCoinError`.
 */
export const listListingChains = (
  db: Db,
  cmcId: CmcId,
  exchange: Exchange
): Effect.Effect<Array<ListingChain>, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  resolveListingId(db, "listListingChains", cmcId, exchange).pipe(
    Effect.flatMap((listingId) =>
      Effect.tryPromise({
        try: () =>
          db
            .select({
              chainCode: chains.code,
              exchangeChainCode: exchangeCryptocurrencyChains.exchangeChainCode,
              exchangeChainName: exchangeCryptocurrencyChains.exchangeChainName,
              withdrawEnabled: exchangeCryptocurrencyChains.withdrawEnabled,
              depositEnabled: exchangeCryptocurrencyChains.depositEnabled
            })
            .from(exchangeCryptocurrencyChains)
            .innerJoin(chains, eq(exchangeCryptocurrencyChains.chainId, chains.id))
            .where(eq(exchangeCryptocurrencyChains.exchangeCryptocurrencyId, listingId)),
        catch: (cause) =>
          new StoreUnavailable({ message: `listListingChains: postgres unavailable (${describeCause(cause)})` })
      }).pipe(Effect.flatMap((rows) => Effect.forEach(rows, toListingChain)))
    )
  )

/**
 * Derived transfer-speed reader for one listing.
 *
 * Reads the listing's chain rows and computes speed via the domain
 * `deriveTransferSpeed` pure function: `"unknown"` when no chain rows exist,
 * `"available"` when any chain is fully enabled, else `"unavailable"`. A
 * missing listing fails as `CoinNotFound` (unknown coins have no speed, they
 * are not `"unknown"`).
 *
 * @param db - Drizzle database port (composition root injects the real client).
 * @param cmcId - Branded CoinMarketCap id.
 * @param exchange - Domain exchange.
 * @returns The derived speed, or `CoinNotFound` / `StoreUnavailable` / `InvalidCoinError`.
 */
export const getTransferSpeed = (
  db: Db,
  cmcId: CmcId,
  exchange: Exchange
): Effect.Effect<TransferSpeed, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  listListingChains(db, cmcId, exchange).pipe(Effect.map(deriveTransferSpeed))
