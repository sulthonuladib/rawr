import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import {
  Chain,
  CmcId,
  CoinNotFound,
  Exchange,
  exchangeToSlug,
  InvalidCoinError,
  ListingChain,
  parseChain,
  parseListingChain,
  StoreUnavailable
} from "@rawr/domain"
import type { Db } from "./schema.js"
import {
  chains,
  cryptocurrencies,
  exchangeCryptocurrencies,
  exchangeCryptocurrencyChains,
  exchanges
} from "./schema.js"

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const firstRowOr = <A, E>(rows: ReadonlyArray<A>, fail: () => E): Effect.Effect<A, E> => {
  const row = rows[0]

  return row === undefined ? Effect.fail(fail()) : Effect.succeed(row)
}

export interface ListingChainInput {
  readonly cmcId: CmcId
  readonly exchange: Exchange
  readonly chainCode: string
  readonly exchangeChainCode: string
  readonly exchangeChainName: string
  readonly withdrawEnabled: boolean
  readonly depositEnabled: boolean
}

const toChain = (row: { readonly code: string; readonly name: string }): Effect.Effect<Chain, InvalidCoinError> =>
  parseChain({ code: row.code, name: row.name })

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

const resolveListingId = (
  db: Db,
  operation: string,
  cmcId: CmcId,
  exchange: Exchange
): Effect.Effect<number, CoinNotFound | StoreUnavailable> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
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
    })

    const row = yield* firstRowOr(
      rows,
      () => new CoinNotFound({ cmcId, message: `${operation}: no listing for cmcId ${cmcId} on ${exchange}` })
    )

    return row.id
  })

const resolveChainId = (
  db: Db,
  operation: string,
  chainCode: string
): Effect.Effect<number, InvalidCoinError | StoreUnavailable> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () => db.select({ id: chains.id }).from(chains).where(eq(chains.code, chainCode)).limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `${operation}: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(
      rows,
      () => new InvalidCoinError({ message: `${operation}: unknown chain code (${chainCode})` })
    )

    return row.id
  })

export const upsertChain = (
  db: Db,
  chain: Chain
): Effect.Effect<Chain, StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
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
    })

    const row = yield* firstRowOr(rows, () => new StoreUnavailable({ message: `upsertChain: postgres returned no row` }))

    return yield* toChain(row)
  })

export const listChains = (db: Db): Effect.Effect<Array<Chain>, StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(chains).orderBy(chains.code),
      catch: (cause) =>
        new StoreUnavailable({ message: `listChains: postgres unavailable (${describeCause(cause)})` })
    })

    return yield* Effect.forEach(rows, toChain)
  })

export const upsertListingChain = (
  db: Db,
  input: ListingChainInput
): Effect.Effect<ListingChain, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const listingId = yield* resolveListingId(db, "upsertListingChain", input.cmcId, input.exchange)
    const chainId = yield* resolveChainId(db, "upsertListingChain", input.chainCode)
    const exchangeChainName = toNullableExchangeChainName(input.exchangeChainName)

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .insert(exchangeCryptocurrencyChains)
          .values({
            exchangeCryptocurrencyId: listingId,
            chainId,
            exchangeChainCode: input.exchangeChainCode,
            exchangeChainName,
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
              exchangeChainName,
              withdrawEnabled: input.withdrawEnabled,
              depositEnabled: input.depositEnabled,
              updatedAt: new Date()
            }
          })
          .returning(),
      catch: (cause) =>
        new StoreUnavailable({ message: `upsertListingChain: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(
      rows,
      () => new StoreUnavailable({ message: `upsertListingChain: postgres returned no row` })
    )

    return yield* toListingChain({
      chainCode: input.chainCode,
      exchangeChainCode: row.exchangeChainCode,
      exchangeChainName: row.exchangeChainName,
      withdrawEnabled: row.withdrawEnabled,
      depositEnabled: row.depositEnabled
    })
  })

export const updateListingChainFlags = (
  db: Db,
  input: ListingChainInput
): Effect.Effect<ListingChain, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const listingId = yield* resolveListingId(db, "updateListingChainFlags", input.cmcId, input.exchange)
    const chainId = yield* resolveChainId(db, "updateListingChainFlags", input.chainCode)

    const rows = yield* Effect.tryPromise({
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
    })

    const row = yield* firstRowOr(
      rows,
      () =>
        new InvalidCoinError({
          message: `updateListingChainFlags: no row for cmcId ${input.cmcId} on ${input.exchange} chain ${input.chainCode}`
        })
    )

    return yield* toListingChain({
      chainCode: input.chainCode,
      exchangeChainCode: row.exchangeChainCode,
      exchangeChainName: row.exchangeChainName,
      withdrawEnabled: row.withdrawEnabled,
      depositEnabled: row.depositEnabled
    })
  })

export const listListingChains = (
  db: Db,
  cmcId: CmcId,
  exchange: Exchange
): Effect.Effect<Array<ListingChain>, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const listingId = yield* resolveListingId(db, "listListingChains", cmcId, exchange)

    const rows = yield* Effect.tryPromise({
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
    })

    return yield* Effect.forEach(rows, toListingChain)
  })

const toNullableExchangeChainName = (exchangeChainName: string): string | null =>
  exchangeChainName === "" ? null : exchangeChainName
