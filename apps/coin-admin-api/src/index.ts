export const packageName = "@rawr/coin-admin-api" as const

export {
  chains,
  coinOutbox,
  cryptocurrencies,
  cryptocurrencyStatusEnum,
  EXCHANGE_SEED,
  exchangeCryptocurrencies,
  exchangeCryptocurrencyChains,
  exchanges,
  schema
} from "./schema.js"

export type {
  ChainInsert,
  ChainRow,
  CoinOutboxInsert,
  CoinOutboxRow,
  CryptocurrencyInsert,
  CryptocurrencyRow,
  CryptocurrencyStatusValue,
  Db,
  DbOrTx,
  DbTx,
  ExchangeCryptocurrencyChainInsert,
  ExchangeCryptocurrencyChainRow,
  ExchangeCryptocurrencyInsert,
  ExchangeCryptocurrencyRow,
  ExchangeInsert,
  ExchangeRow
} from "./schema.js"

export {
  Cryptocurrency,
  decodeCryptocurrency,
  encodeCryptocurrency,
  getCoin,
  listCoins,
  parseCryptocurrency,
  setCoinStatus,
  upsertCoin
} from "./cryptocurrency.js"

export type { CoinStatusValue, CryptocurrencyEncoded, UpsertCoinInput } from "./cryptocurrency.js"

export {
  decodeExchangeInfo,
  encodeExchangeInfo,
  ExchangeInfo,
  getExchange,
  listExchanges,
  parseExchangeInfo
} from "./exchange.js"

export type { ExchangeInfoEncoded } from "./exchange.js"

export {
  decodeListing,
  encodeListing,
  getListing,
  Listing,
  listListings,
  parseListing,
  setAlternateSymbol,
  setListingEnabled
} from "./listings.js"

export type { ListingEncoded, ListListingsFilter } from "./listings.js"

export { CoinAdmin, insertOutboxRow, setCoinStatusTx } from "./service.js"

export type { CoinAdminService } from "./service.js"

export {
  listUnsentOutbox,
  markOutboxSent,
  relayOutboxOnce,
  relayOutboxRow
} from "./relay.js"

export type { RelayOutboxOptions } from "./relay.js"

export { RoutesLive } from "./routes.js"

export type { ApiError } from "./routes.js"

export { AdminApiLive } from "./server.js"

export { ClientError, makeCoinAdminClient } from "./client.js"

export {
  AlternateSymbol,
  Chain,
  CmcId,
  Exchange,
  ListingChain,
  Symbol,
  TransferSpeed
} from "./client.js"

export type {
  CoinAdminClient,
  CoinAdminClientOptions,
  ListListingsQuery,
  PatchListingInput,
  SpeedBody
} from "./client.js"

export {
  getTransferSpeed,
  listChains,
  listListingChains,
  updateListingChainFlags,
  upsertChain,
  upsertListingChain
} from "./chains.js"

export type { ListingChainInput } from "./chains.js"

export { insertCrypto, insertListing } from "./fixtures.js"
