/**
 * `@rawr/domain/chain` — transfer-network registry and per-listing flags.
 *
 * `Chain` is the canonical network (`code` + `name`); `ListingChain` carries
 * one listing's view of that network (exchange code/name overrides plus
 * `withdraw_enabled` / `deposit_enabled` facts). Transfer speed is never
 * stored — `deriveTransferSpeed` computes it from chain rows at read time.
 *
 * @module
 */
import { Effect, Schema } from "effect"
import { InvalidCoinError } from "./errors.js"

/**
 * Canonical transfer network (e.g. code `"BTC"`, name `"Bitcoin"`).
 */
export class Chain extends Schema.Class<Chain>("@rawr/domain/Chain")({
  code: Schema.NonEmptyString,
  name: Schema.NonEmptyString
}) {}

/** Encoded (wire) representation of `Chain`. */
export type ChainEncoded = typeof Chain["Encoded"]

/**
 * Reusable decoder for `Chain` (defined once, called at edges). Fails with
 * `SchemaError`; use `parseChain` for the domain `InvalidCoinError`.
 */
export const decodeChain = Schema.decodeUnknownEffect(Chain)

/**
 * Reusable encoder for `Chain` (domain value back to wire format).
 */
export const encodeChain = Schema.encodeEffect(Chain)

/**
 * Parse unknown edge input into a `Chain`, mapping `SchemaError` to
 * `InvalidCoinError`.
 *
 * @param input untrusted input from an HTTP/store boundary
 * @returns the decoded chain, or `InvalidCoinError`
 */
export const parseChain = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<Chain, InvalidCoinError, typeof Chain["DecodingServices"]> =>
  decodeChain(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )

/**
 * One listing's view of a transfer network.
 *
 * `chainCode` is the canonical network code; `exchangeChainCode` is the
 * exchange's spelling of it; `exchangeChainName` is an optional override
 * (`""` means no override, avoiding `exactOptionalPropertyTypes` friction).
 * Flags default to `true` at the store layer.
 */
export class ListingChain extends Schema.Class<ListingChain>("@rawr/domain/ListingChain")({
  chainCode: Schema.NonEmptyString,
  exchangeChainCode: Schema.NonEmptyString,
  exchangeChainName: Schema.String,
  withdrawEnabled: Schema.Boolean,
  depositEnabled: Schema.Boolean
}) {}

/** Encoded (wire) representation of `ListingChain`. */
export type ListingChainEncoded = typeof ListingChain["Encoded"]

/**
 * Reusable decoder for `ListingChain` (defined once, called at edges). Fails
 * with `SchemaError`; use `parseListingChain` for `InvalidCoinError`.
 */
export const decodeListingChain = Schema.decodeUnknownEffect(ListingChain)

/**
 * Reusable encoder for `ListingChain` (domain value back to wire format).
 */
export const encodeListingChain = Schema.encodeEffect(ListingChain)

/**
 * Parse unknown edge input into a `ListingChain`, mapping `SchemaError` to
 * `InvalidCoinError`.
 *
 * @param input untrusted input from an HTTP/store boundary
 * @returns the decoded listing chain, or `InvalidCoinError`
 */
export const parseListingChain = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<ListingChain, InvalidCoinError, typeof ListingChain["DecodingServices"]> =>
  decodeListingChain(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )

/**
 * Derived transfer speed for one listing, computed from its chain rows.
 *
 * - `"unknown"` — the listing has no chain rows (nothing to derive from).
 * - `"available"` — at least one chain has both withdraw and deposit enabled.
 * - `"unavailable"` — chains exist but none is fully enabled (e.g. all
 *   withdrawals disabled).
 */
export const TransferSpeed = Schema.Literals(["available", "unavailable", "unknown"])

/** Type-level derived transfer speed. */
export type TransferSpeed = typeof TransferSpeed["Type"]

/** Encoded (wire) representation of `TransferSpeed`. */
export type TransferSpeedEncoded = typeof TransferSpeed["Encoded"]

/**
 * Derive transfer speed from a listing's chain rows (pure, no I/O).
 *
 * @param chains - the listing's chain rows (possibly empty)
 * @returns `"unknown"` when empty, `"available"` when any chain is fully
 * enabled, else `"unavailable"`
 */
export const deriveTransferSpeed = (chains: ReadonlyArray<ListingChain>): TransferSpeed =>
  chains.length === 0
    ? "unknown"
    : chains.some((chain) => chain.withdrawEnabled && chain.depositEnabled)
      ? "available"
      : "unavailable"
