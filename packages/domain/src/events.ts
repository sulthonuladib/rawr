/**
 * `@rawr/domain/events` — the `CoinUpdated` domain event.
 *
 * Coin activate/deactivate flows only through this event plus a `FiberMap`
 * diff — never `deleteMany` / `clearDB`. Publishers (coin-admin API after a
 * tx update) emit it; subscribers (ingest-sender) diff it against running
 * fibers.
 *
 * @module
 */
import { Effect, Schema } from "effect"
import { CmcId, Symbol } from "./brands.js"
import { InvalidCoinError } from "./errors.js"
import { CoinStatus } from "./status.js"

/**
 * Coin listing change event, tagged `_tag: "CoinUpdated"` for bus routing.
 *
 * `status` carries the new lifecycle (`Active` / `Inactive`); `reason`
 * is `""` when unset.
 */
export class CoinUpdated extends Schema.TaggedClass<CoinUpdated>()("CoinUpdated", {
  cmcId: CmcId,
  symbol: Symbol,
  status: CoinStatus,
  reason: Schema.String
}) {}

/** Encoded (wire) representation of `CoinUpdated`. */
export type CoinUpdatedEncoded = typeof CoinUpdated["Encoded"]

/**
 * Reusable decoder for `CoinUpdated` (defined once, called at pub/sub edges).
 */
export const decodeCoinUpdated = Schema.decodeUnknownEffect(CoinUpdated)

/**
 * Reusable encoder for `CoinUpdated`.
 */
export const encodeCoinUpdated = Schema.encodeEffect(CoinUpdated)

/**
 * Parse unknown edge input into a `CoinUpdated` event, mapping `SchemaError`
 * to `InvalidCoinError`.
 *
 * @param input untrusted input from the message bus
 * @returns the decoded event, or `InvalidCoinError`
 */
export const parseCoinUpdated = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<CoinUpdated, InvalidCoinError, typeof CoinUpdated["DecodingServices"]> =>
  decodeCoinUpdated(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )
