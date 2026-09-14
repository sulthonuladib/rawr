export const packageName = "@rawr/coin-store" as const

export {
  chains,
  cryptocurrencies,
  cryptocurrencyStatusEnum,
  EXCHANGE_SEED,
  exchangeCryptocurrencies,
  exchangeCryptocurrencyChains,
  exchangeOpportunities,
  exchanges,
  exchangeSnapshots,
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
  ExchangeOpportunityInsert,
  ExchangeOpportunityRow,
  ExchangeRow,
  ExchangeSnapshotInsert,
  ExchangeSnapshotRow
} from "./schema.js"

export { exchangeToSlug, slugToExchange } from "./exchanges.js"

export {
  listOpportunities,
  saveOpportunity,
  saveSnapshot
} from "./exchange-store.js"

export type {
  ListOpportunitiesOptions,
  StoredOpportunity
} from "./exchange-store.js"

export {
  getTransferSpeed,
  listChains,
  listListingChains,
  updateListingChainFlags,
  upsertChain,
  upsertListingChain
} from "./chains.js"

export type { ListingChainInput } from "./chains.js"
