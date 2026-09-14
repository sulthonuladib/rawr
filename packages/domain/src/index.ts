/**
 * `@rawr/domain` — shared domain Schemas and errors.
 *
 * Branded primitives (`CmcId`, `Symbol`, `AlternateSymbol`), the exact
 * 15-exchange union, `ActiveCoin` with per-exchange `{ enabled, alternate }`
 * listings, `CoinStatus` (`Active | Inactive`) tagged union, `OrderbookTick`,
 * `Opportunity`, the `CoinUpdated` event, and `TaggedError` failures
 * (`CoinNotFound`, `InvalidCoinError`, `StoreUnavailable`).
 *
 * Rule: every HTTP/WS/AMQP edge decodes through these Schemas (parse, don't
 * validate). Errors are values (`Effect.fail`), never `throw`. No
 * `process.env`, no DB access in this package.
 *
 * @module
 */
/** Package identifier. */
export const packageName = "@rawr/domain" as const

/** Branded primitives + the 15-exchange union. */
export {
  AlternateSymbol,
  CmcId,
  Exchange,
  Exchanges,
  Symbol
} from "./brands.js"

/** Branded-primitive wire types. */
export type {
  AlternateSymbolEncoded,
  CmcIdEncoded,
  ExchangeEncoded,
  SymbolEncoded
} from "./brands.js"

/** Domain failures as values. */
export { CoinNotFound, InvalidCoinError, StoreUnavailable } from "./errors.js"

/** The `ActiveCoin` aggregate, listings, and its edge parser. */
export {
  ActiveCoin,
  decodeActiveCoin,
  encodeActiveCoin,
  ExchangeListing,
  parseActiveCoin
} from "./coin.js"

/** `ActiveCoin` wire types. */
export type { ActiveCoinEncoded, ExchangeListingEncoded } from "./coin.js"

/** Coin lifecycle tagged union. */
export { CoinActive, CoinInactive, CoinStatus } from "./status.js"

/** Coin lifecycle wire types. */
export type { CoinStatusEncoded } from "./status.js"

/** Orderbook ticks, opportunities, and their edge parsers. */
export {
  decodeOpportunity,
  decodeOrderbookTick,
  encodeOpportunity,
  encodeOrderbookTick,
  NonNegativeNumber,
  Opportunity,
  OrderbookTick,
  parseOpportunity,
  parseOrderbookTick
} from "./market.js"

/** Market wire types. */
export type {
  NonNegativeNumberEncoded,
  OpportunityEncoded,
  OrderbookTickEncoded
} from "./market.js"

/** The `CoinUpdated` event and its edge parser. */
export {
  CoinUpdated,
  decodeCoinUpdated,
  encodeCoinUpdated,
  parseCoinUpdated
} from "./events.js"

/** Event wire types. */
export type { CoinUpdatedEncoded } from "./events.js"
