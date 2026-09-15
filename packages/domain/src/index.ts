export const packageName = "@rawr/domain" as const

export {
  AlternateSymbol,
  CmcId,
  Exchange,
  Exchanges,
  Symbol
} from "./brands.js"

export type {
  AlternateSymbolEncoded,
  CmcIdEncoded,
  ExchangeEncoded,
  SymbolEncoded
} from "./brands.js"

export { CoinNotFound, InvalidCoinError, StoreUnavailable } from "./errors.js"

export {
  Chain,
  decodeChain,
  decodeListingChain,
  encodeChain,
  encodeListingChain,
  ListingChain,
  parseChain,
  parseListingChain
} from "./chain.js"

export type { ChainEncoded, ListingChainEncoded } from "./chain.js"

export { CoinActive, CoinInactive, CoinStatus } from "./status.js"

export type { CoinStatusEncoded } from "./status.js"

export { exchangeToSlug, slugToExchange } from "./exchanges.js"

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

export type {
  NonNegativeNumberEncoded,
  OpportunityEncoded,
  OrderbookTickEncoded
} from "./exchange.js"

export {
  CoinUpdated,
  decodeCoinUpdated,
  encodeCoinUpdated,
  parseCoinUpdated
} from "./events.js"

export type { CoinUpdatedEncoded } from "./events.js"
