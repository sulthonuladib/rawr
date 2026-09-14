export const packageName = "@rawr/coin-admin-api" as const

export {
  chains,
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
  CryptocurrencyInsert,
  CryptocurrencyRow,
  CryptocurrencyStatusValue,
  Db,
  ExchangeCryptocurrencyChainInsert,
  ExchangeCryptocurrencyChainRow,
  ExchangeCryptocurrencyInsert,
  ExchangeCryptocurrencyRow,
  ExchangeInsert,
  ExchangeRow
} from "./schema.js"

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
