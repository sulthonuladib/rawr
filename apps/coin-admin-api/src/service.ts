import { Context, Effect, Layer } from "effect"
import {
  CmcId,
  CoinActive,
  CoinInactive,
  CoinNotFound,
  CoinUpdated,
  encodeCoinUpdated,
  InvalidCoinError,
  StoreUnavailable
} from "@rawr/domain"
import type { CoinUpdatedEncoded } from "@rawr/domain"
import type { Cryptocurrency } from "./cryptocurrency.js"
import { getCoin, listCoins, setCoinStatus, upsertCoin } from "./cryptocurrency.js"
import type { CoinStatusValue, UpsertCoinInput } from "./cryptocurrency.js"
import type { Db, DbOrTx, DbTx } from "./schema.js"
import { coinOutbox } from "./schema.js"

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

// Rejections crossing the drizzle promise boundary come back as unknown:
// expected domain failures keep their type, everything else is the store.
const toTxError = (
  operation: string,
  cause: unknown
): CoinNotFound | InvalidCoinError | StoreUnavailable => {
  if (cause instanceof CoinNotFound) {
    return cause
  }

  if (cause instanceof InvalidCoinError) {
    return cause
  }

  return new StoreUnavailable({ message: `${operation}: postgres unavailable (${describeCause(cause)})` })
}

export const insertOutboxRow = (
  db: DbOrTx,
  cmcId: CmcId,
  payload: CoinUpdatedEncoded
): Effect.Effect<void, StoreUnavailable> =>
  Effect.gen(function*() {
    yield* Effect.asVoid(Effect.tryPromise({
      try: () => db.insert(coinOutbox).values({ cmcId, payload }),
      catch: (cause) =>
        new StoreUnavailable({ message: `insertOutboxRow: postgres unavailable (${describeCause(cause)})` })
    }))
  })

const toCoinUpdated = (coin: Cryptocurrency): CoinUpdated =>
  new CoinUpdated({
    cmcId: coin.cmcId,
    symbol: coin.symbol,
    status: coin.status === "active" ? new CoinActive({ cmcId: coin.cmcId }) : new CoinInactive({
      cmcId: coin.cmcId,
      reason: coin.reason
    }),
    reason: coin.reason
  })

export const setCoinStatusTx = (
  db: Db,
  cmcId: CmcId,
  status: CoinStatusValue,
  reason: string
): Effect.Effect<Cryptocurrency, CoinNotFound | StoreUnavailable | InvalidCoinError> =>
  Effect.tryPromise({
    try: () =>
      db.transaction((tx: DbTx) =>
        Effect.runPromise(Effect.gen(function*() {
          const coin = yield* setCoinStatus(tx, cmcId, status, reason)

          const payload = yield* encodeCoinUpdated(toCoinUpdated(coin)).pipe(
            Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
          )

          yield* insertOutboxRow(tx, cmcId, payload)

          return coin
        }))
      ),
    catch: (cause) => toTxError("setCoinStatusTx", cause)
  })

export interface CoinAdminService {
  readonly upsertCoin: (
    input: UpsertCoinInput
  ) => Effect.Effect<Cryptocurrency, StoreUnavailable | InvalidCoinError>
  readonly getCoin: (
    cmcId: CmcId
  ) => Effect.Effect<Cryptocurrency, CoinNotFound | StoreUnavailable | InvalidCoinError>
  readonly listCoins: (
    status?: CoinStatusValue | undefined
  ) => Effect.Effect<Array<Cryptocurrency>, StoreUnavailable | InvalidCoinError>
  readonly setStatus: (
    cmcId: CmcId,
    status: CoinStatusValue,
    reason: string
  ) => Effect.Effect<Cryptocurrency, CoinNotFound | StoreUnavailable | InvalidCoinError>
}

export class CoinAdmin extends Context.Service<CoinAdmin, CoinAdminService>()(
  "@rawr/coin-admin-api/CoinAdmin"
) {
  static readonly layer = (db: Db): Layer.Layer<CoinAdmin> =>
    Layer.succeed(
      CoinAdmin,
      CoinAdmin.of({
        upsertCoin: (input) => upsertCoin(db, input),
        getCoin: (cmcId) => getCoin(db, cmcId),
        listCoins: (status) => listCoins(db, status),
        setStatus: (cmcId, status, reason) => setCoinStatusTx(db, cmcId, status, reason)
      })
    )
}
