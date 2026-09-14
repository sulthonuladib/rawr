/**
 * `@rawr/domain` — shared domain Schemas and errors.
 *
 * Branded primitives (`CmcId`, `Symbol`, `AlternateSymbol`), the exact
 * 15-exchange union (edge-validation set), `Chain` / `ListingChain` plus
 * derived `TransferSpeed`, `CoinStatus` (`Active | Inactive`) tagged union,
 * `OrderbookTick`, `Opportunity`, the `CoinUpdated` event, and `TaggedError`
 * failures (`CoinNotFound`, `InvalidCoinError`, `StoreUnavailable`).
 *
 * There is no coin aggregate in this package — services query the
 * `cryptocurrencies` / `exchange_cryptocurrency` tables directly for what
 * they need.
 *
 * Rule: every HTTP/WS/AMQP edge decodes through these Schemas (parse, don't
 * validate). Errors are values (`Effect.fail`), never `throw`. No
 * `process.env`, no DB access in this package.
 *
 * @module
 */
/** Package identifier. */
export const packageName = "@rawr/domain" as const

/** Branded primitives + the 15-exchange union (edge-validation set). */
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

/** Chain registry, per-listing flags, and derived transfer speed. */
export {
  Chain,
  decodeChain,
  decodeListingChain,
  deriveTransferSpeed,
  encodeChain,
  encodeListingChain,
  ListingChain,
  parseChain,
  parseListingChain,
  TransferSpeed
} from "./chain.js"

/** Chain wire types. */
export type {
  ChainEncoded,
  ListingChainEncoded,
  TransferSpeedEncoded
} from "./chain.js"

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
} from "./exchange.js"

/** Market wire types. */
export type {
  NonNegativeNumberEncoded,
  OpportunityEncoded,
  OrderbookTickEncoded
} from "./exchange.js"

/** The `CoinUpdated` event and its edge parser. */
export {
  CoinUpdated,
  decodeCoinUpdated,
  encodeCoinUpdated,
  parseCoinUpdated
} from "./events.js"

/** Event wire types. */
export type { CoinUpdatedEncoded } from "./events.js"
