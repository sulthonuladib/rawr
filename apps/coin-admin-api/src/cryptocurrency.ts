import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { CmcId, CoinNotFound, InvalidCoinError, StoreUnavailable, Symbol } from "@rawr/domain"
import type { DbOrTx } from "./schema.js"
import { cryptocurrencies } from "./schema.js"

export class Cryptocurrency extends Schema.Class<Cryptocurrency>("@rawr/coin-admin-api/Cryptocurrency")({
  cmcId: CmcId,
  symbol: Symbol,
  name: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  logo: Schema.String,
  status: Schema.Literals(["active", "inactive"]),
  reason: Schema.String
}) {}

export type CryptocurrencyEncoded = typeof Cryptocurrency["Encoded"]

export const decodeCryptocurrency = Schema.decodeUnknownEffect(Cryptocurrency)

export const encodeCryptocurrency = Schema.encodeEffect(Cryptocurrency)

export const parseCryptocurrency = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<Cryptocurrency, InvalidCoinError> =>
  decodeCryptocurrency(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )

export interface UpsertCoinInput {
  readonly cmcId: CmcId
  readonly symbol: Symbol
  readonly name: string
  readonly slug: string
  readonly logo: string
}

export type CoinStatusValue = "active" | "inactive"

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const firstRowOr = <A, E>(rows: ReadonlyArray<A>, fail: () => E): Effect.Effect<A, E> => {
  const row = rows[0]

  return row === undefined ? Effect.fail(fail()) : Effect.succeed(row)
}

const toCryptocurrency = (
  row: typeof cryptocurrencies.$inferSelect
): Effect.Effect<Cryptocurrency, InvalidCoinError> =>
  parseCryptocurrency({
    cmcId: row.cmcId,
    symbol: row.symbol,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    status: row.status,
    reason: row.reason
  })

export const upsertCoin = (
  db: DbOrTx,
  input: UpsertCoinInput
): Effect.Effect<Cryptocurrency, StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .insert(cryptocurrencies)
          .values({
            cmcId: input.cmcId,
            symbol: input.symbol,
            name: input.name,
            slug: input.slug,
            logo: input.logo
          })
          .onConflictDoUpdate({
            target: cryptocurrencies.cmcId,
            set: {
              symbol: input.symbol,
              name: input.name,
              slug: input.slug,
              logo: input.logo,
              updatedAt: new Date()
            }
          })
          .returning(),
      catch: (cause) =>
        new StoreUnavailable({ message: `upsertCoin: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(rows, () => new StoreUnavailable({ message: `upsertCoin: postgres returned no row` }))

    return yield* toCryptocurrency(row)
  })

export const getCoin = (
  db: DbOrTx,
  cmcId: CmcId
): Effect.Effect<Cryptocurrency, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(cryptocurrencies).where(eq(cryptocurrencies.cmcId, cmcId)).limit(1),
      catch: (cause) =>
        new StoreUnavailable({ message: `getCoin: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(
      rows,
      () => new CoinNotFound({ cmcId, message: `getCoin: no coin for cmcId ${cmcId}` })
    )

    return yield* toCryptocurrency(row)
  })

export const listCoins = (
  db: DbOrTx,
  status?: CoinStatusValue | undefined
): Effect.Effect<Array<Cryptocurrency>, StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () =>
        status === undefined
          ? db.select().from(cryptocurrencies).orderBy(cryptocurrencies.cmcId)
          : db.select().from(cryptocurrencies).where(eq(cryptocurrencies.status, status)).orderBy(
            cryptocurrencies.cmcId
          ),
      catch: (cause) =>
        new StoreUnavailable({ message: `listCoins: postgres unavailable (${describeCause(cause)})` })
    })

    return yield* Effect.forEach(rows, toCryptocurrency)
  })

export const setCoinStatus = (
  db: DbOrTx,
  cmcId: CmcId,
  status: CoinStatusValue,
  reason: string
): Effect.Effect<Cryptocurrency, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .update(cryptocurrencies)
          .set({ status, reason, updatedAt: new Date() })
          .where(eq(cryptocurrencies.cmcId, cmcId))
          .returning(),
      catch: (cause) =>
        new StoreUnavailable({ message: `setCoinStatus: postgres unavailable (${describeCause(cause)})` })
    })

    const row = yield* firstRowOr(
      rows,
      () => new CoinNotFound({ cmcId, message: `setCoinStatus: no coin for cmcId ${cmcId}` })
    )

    return yield* toCryptocurrency(row)
  })
