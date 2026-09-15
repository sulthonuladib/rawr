import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import {
  AlternateSymbol,
  CmcId,
  CoinNotFound,
  Exchange,
  exchangeToSlug,
  InvalidCoinError,
  slugToExchange,
  StoreUnavailable
} from "@rawr/domain"
import type { DbOrTx } from "./schema.js"
import { cryptocurrencies, exchangeCryptocurrencies, exchanges } from "./schema.js"

export class Listing extends Schema.Class<Listing>("@rawr/coin-admin-api/Listing")({
  cmcId: CmcId,
  exchange: Exchange,
  enabled: Schema.Boolean,
  alternateSymbol: AlternateSymbol
}) {}

export type ListingEncoded = typeof Listing["Encoded"]

export const decodeListing = Schema.decodeUnknownEffect(Listing)

export const encodeListing = Schema.encodeEffect(Listing)

export const parseListing = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<Listing, InvalidCoinError> =>
  decodeListing(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )

export interface ListListingsFilter {
  readonly cmcId?: CmcId | undefined
  readonly exchange?: Exchange | undefined
  readonly enabled?: boolean | undefined
}

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const firstRowOr = <A, E>(rows: ReadonlyArray<A>, fail: () => E): Effect.Effect<A, E> => {
  const row = rows[0]

  return row === undefined ? Effect.fail(fail()) : Effect.succeed(row)
}

interface ListingRow {
  readonly cmcId: number
  readonly exchangeSlug: string
  readonly enabled: boolean
  readonly alternateSymbol: string
}

const toListing = (row: ListingRow): Effect.Effect<Listing, InvalidCoinError> =>
  Effect.gen(function*() {
    const exchange = yield* slugToExchange(row.exchangeSlug)

    return yield* parseListing({
      cmcId: row.cmcId,
      exchange,
      enabled: row.enabled,
      alternateSymbol: row.alternateSymbol
    })
  })

const baseListingQuery = (db: DbOrTx) =>
  db
    .select({
      cmcId: cryptocurrencies.cmcId,
      exchangeSlug: exchanges.slug,
      enabled: exchangeCryptocurrencies.enabled,
      alternateSymbol: exchangeCryptocurrencies.alternateSymbol
    })
    .from(exchangeCryptocurrencies)
    .innerJoin(cryptocurrencies, eq(exchangeCryptocurrencies.cryptocurrencyId, cryptocurrencies.id))
    .innerJoin(exchanges, eq(exchangeCryptocurrencies.exchangeId, exchanges.id))

const describeListing = (cmcId: CmcId, exchange: Exchange): string =>
  `cmcId ${cmcId} on ${exchange}`

export const getListing = (
  db: DbOrTx,
  cmcId: CmcId,
  exchange: Exchange
): Effect.Effect<Listing, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () =>
        baseListingQuery(db).where(
          and(
            eq(cryptocurrencies.cmcId, cmcId),
            eq(exchanges.slug, exchangeToSlug(exchange))
          )
        ).limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `getListing: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(
      rows,
      () => new CoinNotFound({ cmcId, message: `getListing: no listing for ${describeListing(cmcId, exchange)}` })
    )

    return yield* toListing(row)
  })

export const listListings = (
  db: DbOrTx,
  filter?: ListListingsFilter | undefined
): Effect.Effect<Array<Listing>, StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () => {
        const conditions = []

        if (filter?.cmcId !== undefined) {
          conditions.push(eq(cryptocurrencies.cmcId, filter.cmcId))
        }

        if (filter?.exchange !== undefined) {
          conditions.push(eq(exchanges.slug, exchangeToSlug(filter.exchange)))
        }

        if (filter?.enabled !== undefined) {
          conditions.push(eq(exchangeCryptocurrencies.enabled, filter.enabled))
        }

        const query = baseListingQuery(db)

        return conditions.length === 0 ? query : query.where(and(...conditions))
      },
      catch: (cause) =>
        new StoreUnavailable({ message: `listListings: postgres unavailable (${describeCause(cause)})` })
    })

    return yield* Effect.forEach(rows, toListing)
  })

const updateListingRow = (
  db: DbOrTx,
  operation: string,
  cmcId: CmcId,
  exchange: Exchange,
  set: { readonly enabled?: boolean | undefined; readonly alternateSymbol?: string | undefined }
): Effect.Effect<ListingRow, CoinNotFound | StoreUnavailable> =>
  Effect.gen(function*() {
    const listingRows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: exchangeCryptocurrencies.id })
          .from(exchangeCryptocurrencies)
          .innerJoin(cryptocurrencies, eq(exchangeCryptocurrencies.cryptocurrencyId, cryptocurrencies.id))
          .innerJoin(exchanges, eq(exchangeCryptocurrencies.exchangeId, exchanges.id))
          .where(and(eq(cryptocurrencies.cmcId, cmcId), eq(exchanges.slug, exchangeToSlug(exchange))))
          .limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `${operation}: postgres unavailable (${describeCause(cause)})` })
    })

    const listing = yield* firstRowOr(
      listingRows,
      () => new CoinNotFound({ cmcId, message: `${operation}: no listing for ${describeListing(cmcId, exchange)}` })
    )

    yield* Effect.tryPromise({
      try: () =>
        db
          .update(exchangeCryptocurrencies)
          .set({ ...set, updatedAt: new Date() })
          .where(eq(exchangeCryptocurrencies.id, listing.id)),
      catch: (cause) =>
        new StoreUnavailable({ message: `${operation}: postgres unavailable (${describeCause(cause)})` })
    })

    // Update cannot return joined columns: re-read the row through the base query.
    return yield* getListingRow(db, operation, cmcId, exchange)
  })

const getListingRow = (
  db: DbOrTx,
  operation: string,
  cmcId: CmcId,
  exchange: Exchange
): Effect.Effect<ListingRow, CoinNotFound | StoreUnavailable> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () =>
        baseListingQuery(db).where(
          and(
            eq(cryptocurrencies.cmcId, cmcId),
            eq(exchanges.slug, exchangeToSlug(exchange))
          )
        ).limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `${operation}: postgres unavailable (${describeCause(cause)})` })
    })

    return yield* firstRowOr(
      rows,
      () => new CoinNotFound({ cmcId, message: `${operation}: no listing for ${describeListing(cmcId, exchange)}` })
    )
  })

export const setListingEnabled = (
  db: DbOrTx,
  cmcId: CmcId,
  exchange: Exchange,
  enabled: boolean
): Effect.Effect<Listing, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const row = yield* updateListingRow(db, "setListingEnabled", cmcId, exchange, { enabled })

    return yield* toListing(row)
  })

export const setAlternateSymbol = (
  db: DbOrTx,
  cmcId: CmcId,
  exchange: Exchange,
  alternateSymbol: AlternateSymbol
): Effect.Effect<Listing, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const row = yield* updateListingRow(db, "setAlternateSymbol", cmcId, exchange, { alternateSymbol })

    return yield* toListing(row)
  })
