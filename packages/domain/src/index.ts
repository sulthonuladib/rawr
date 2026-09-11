/**
 * `@rawr/domain` — shared domain Schemas and errors.
 *
 * Skeleton placeholder (Phase 0). Phase 1 adds `Schema` definitions for
 * `CmcId`, `Exchange`, `ActiveCoin`, `OrderbookTick`, `Opportunity`,
 * `CoinUpdated` plus `TaggedError` failures `CoinNotFound` and
 * `StoreUnavailable`. All HTTP/WS/AMQP edges decode through these Schemas
 * (parse, don't validate).
 *
 * @module
 */

/** Package identifier for the domain skeleton. */
export const packageName = "@rawr/domain" as const;
