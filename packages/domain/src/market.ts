/**
 * `@rawr/domain/market` — orderbook ticks and arbitrage opportunities.
 *
 * Legacy shapes: per-exchange orderbook rows (`cmcId`, `buyPrice`,
 * `sellPrice`, `buyAmount`, `sellAmount` — see
 * `~/Tools/exchange-sender-websocket/src/models/Orderbook.js`) updated from
 * `{ cmcId, asks, bids }` WS payloads, and arbitrage results (`symbol`,
 * buy/sell prices + amounts, buy/sell exchanges, `profitPercentage` formatted
 * with `toFixed(2)` — see `~/Tools/potential/types.go` and
 * `price-diff.service.js`). Prices/amounts are non-negative (`0` means
 * missing on the wire, and legacy guards skip `buyPrice != 0` rows).
 *
 * @module
 */
import { Effect, Schema } from "effect"
import { CmcId, Exchange, Symbol } from "./brands.js"
import { InvalidCoinError } from "./errors.js"

/**
 * Non-negative wire number (price or amount). `0` means "missing" upstream.
 */
export const NonNegativeNumber = Schema.Number.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)

/** Type-level `NonNegativeNumber`. */
export type NonNegativeNumber = typeof NonNegativeNumber["Type"]

/** Encoded (wire) representation of `NonNegativeNumber`. */
export type NonNegativeNumberEncoded = typeof NonNegativeNumber["Encoded"]

/**
 * Normalized orderbook snapshot for one coin on one exchange.
 *
 * The receiver decodes raw `{ cmcId, asks, bids }` payloads elsewhere; this is
 * the post-normalization tick that flows into snapshots and the
 * arbitrage engine.
 */
export class OrderbookTick extends Schema.Class<OrderbookTick>("@rawr/domain/OrderbookTick")({
  cmcId: CmcId,
  exchange: Exchange,
  symbol: Symbol,
  buyPrice: NonNegativeNumber,
  sellPrice: NonNegativeNumber,
  buyAmount: NonNegativeNumber,
  sellAmount: NonNegativeNumber
}) {}

/** Encoded (wire) representation of `OrderbookTick`. */
export type OrderbookTickEncoded = typeof OrderbookTick["Encoded"]

/**
 * Reusable decoder for `OrderbookTick` (defined once, called at edges).
 */
export const decodeOrderbookTick = Schema.decodeUnknownEffect(OrderbookTick)

/**
 * Reusable encoder for `OrderbookTick`.
 */
export const encodeOrderbookTick = Schema.encodeEffect(OrderbookTick)

/**
 * Parse unknown edge input into an `OrderbookTick`, mapping `SchemaError` to
 * `InvalidCoinError`.
 *
 * @param input untrusted input from a WS/AMQP boundary
 * @returns the decoded tick, or `InvalidCoinError`
 */
export const parseOrderbookTick = (
  input: unknown
): Effect.Effect<OrderbookTick, InvalidCoinError, typeof OrderbookTick["DecodingServices"]> =>
  decodeOrderbookTick(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )

/**
 * Arbitrage opportunity between two exchanges for one coin.
 *
 * `profitPercentage` keeps the legacy `toFixed(2)` string format (e.g.
 * `"0.42"`); the engine emits only rows at or above its configured threshold
 * (legacy default `0.5`, plan target `≥ 0.1%` on 2M volume).
 */
export class Opportunity extends Schema.Class<Opportunity>("@rawr/domain/Opportunity")({
  symbol: Symbol,
  cmcId: CmcId,
  buyExchange: Exchange,
  sellExchange: Exchange,
  buyPrice: NonNegativeNumber,
  sellPrice: NonNegativeNumber,
  buyAmount: NonNegativeNumber,
  sellAmount: NonNegativeNumber,
  profitPercentage: Schema.String
}) {}

/** Encoded (wire) representation of `Opportunity`. */
export type OpportunityEncoded = typeof Opportunity["Encoded"]

/**
 * Reusable decoder for `Opportunity` (defined once, called at edges).
 */
export const decodeOpportunity = Schema.decodeUnknownEffect(Opportunity)

/**
 * Reusable encoder for `Opportunity`.
 */
export const encodeOpportunity = Schema.encodeEffect(Opportunity)

/**
 * Parse unknown edge input into an `Opportunity`, mapping `SchemaError` to
 * `InvalidCoinError`.
 *
 * @param input untrusted input from the engine/store boundary
 * @returns the decoded opportunity, or `InvalidCoinError`
 */
export const parseOpportunity = (
  input: unknown
): Effect.Effect<Opportunity, InvalidCoinError, typeof Opportunity["DecodingServices"]> =>
  decodeOpportunity(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )
