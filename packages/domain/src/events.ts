import { Effect, Schema } from "effect"
import { CmcId, Symbol } from "./brands.js"
import { InvalidCoinError } from "./errors.js"
import { CoinStatus } from "./status.js"

export class CoinUpdated extends Schema.TaggedClass<CoinUpdated>()("CoinUpdated", {
  cmcId: CmcId,
  symbol: Symbol,
  status: CoinStatus,
  reason: Schema.String
}) {}

export type CoinUpdatedEncoded = typeof CoinUpdated["Encoded"]

export const decodeCoinUpdated = Schema.decodeUnknownEffect(CoinUpdated)

export const encodeCoinUpdated = Schema.encodeEffect(CoinUpdated)

export const parseCoinUpdated = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<CoinUpdated, InvalidCoinError, typeof CoinUpdated["DecodingServices"]> =>
  decodeCoinUpdated(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )
