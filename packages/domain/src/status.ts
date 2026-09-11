/**
 * `@rawr/domain/status` — coin lifecycle as a tagged union.
 *
 * Activation/deactivation happens only via the `CoinUpdated` event plus a
 * `FiberMap` diff (per `AGENTS.md`); this union is the status payload those
 * events carry.
 *
 * @module
 */
import { Schema } from "effect"
import { CmcId } from "./brands.js"

/**
 * A coin actively tracked on at least one exchange.
 *
 * Tagged `_tag: "Active"` so consumers match with `Schema.Union` narrowing
 * instead of string comparisons.
 */
export class CoinActive extends Schema.TaggedClass<CoinActive>()("Active", {
  cmcId: CmcId
}) {}

/**
 * A coin no longer tracked. `reason` mirrors the legacy `reason` field
 * (`""` when unset).
 */
export class CoinInactive extends Schema.TaggedClass<CoinInactive>()("Inactive", {
  cmcId: CmcId,
  reason: Schema.String
}) {}

/**
 * Coin lifecycle union: `Active | Inactive`, discriminated by `_tag`.
 *
 * Decode at edges; match exhaustively in services.
 */
export const CoinStatus = Schema.Union([CoinActive, CoinInactive])

/** Type-level `CoinStatus` (`CoinActive | CoinInactive`). */
export type CoinStatus = typeof CoinStatus["Type"]

/** Encoded (wire) representation of `CoinStatus`. */
export type CoinStatusEncoded = typeof CoinStatus["Encoded"]
