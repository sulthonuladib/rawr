/**
 * `@rawr/domain/errors` — domain failures as values.
 *
 * Only error pattern in this repo: `Schema.TaggedError` classes raised with
 * `return yield*` / `Effect.fail`, caught with `Effect.catchTag`. Never
 * `throw`.
 *
 * @module
 */
import { Schema } from "effect"
import { CmcId } from "./brands.js"

/**
 * Raised when edge input fails `Schema` decoding (HTTP/WS/AMQP boundary).
 *
 * Parsers in `coin.ts`, `market.ts` and `events.ts` map `SchemaError` into
 * this error so callers handle one stable failure type.
 */
export class InvalidCoinError extends Schema.TaggedError<InvalidCoinError>()("InvalidCoinError", {
  message: Schema.String
}) {}

/**
 * Raised when a coin cannot be found for a `CmcId` (store lookup miss).
 *
 * Carries the requested id plus a human-readable message for logs; the id
 * stays structured so handlers can branch without parsing strings.
 */
export class CoinNotFound extends Schema.TaggedError<CoinNotFound>()("CoinNotFound", {
  cmcId: CmcId,
  message: Schema.String
}) {}

/**
 * Raised when the persistence layer is unreachable (Postgres down, pool
 * exhausted).
 *
 * Listed in `docs/plan.md` Phase 1 alongside `CoinNotFound`; kept here so
 * `coin-store` and services share one definition.
 */
export class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()("StoreUnavailable", {
  message: Schema.String
}) {}
