export const packageName = "@rawr/arbitrage-engine" as const

export { exchangeOpportunities, schema } from "./schema.js"

export type { Db, ExchangeOpportunityInsert, ExchangeOpportunityRow } from "./schema.js"

export { listOpportunities, saveOpportunity } from "./opportunities.js"

export type { ListOpportunitiesOptions, StoredOpportunity } from "./opportunities.js"
