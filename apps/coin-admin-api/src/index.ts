/**
 * `@rawr/coin-admin-api` — coin admin HTTP API.
 *
 * `HttpApi` with `PUT` / `PATCH /coins/:cmcId`: transactional update
 * followed by a `CoinUpdated` publish, with `Schema` decoding at the edge.
 *
 * @module
 */

/** Package identifier for the coin-admin-api skeleton. */
export const packageName = "@rawr/coin-admin-api" as const
