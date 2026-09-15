import { Effect, Schema } from "effect"
import { InvalidCoinError } from "./errors.js"

export class Chain extends Schema.Class<Chain>("@rawr/domain/Chain")({
  code: Schema.NonEmptyString,
  name: Schema.NonEmptyString
}) {}

export type ChainEncoded = typeof Chain["Encoded"]

export const decodeChain = Schema.decodeUnknownEffect(Chain)

export const encodeChain = Schema.encodeEffect(Chain)

export const parseChain = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<Chain, InvalidCoinError, typeof Chain["DecodingServices"]> =>
  decodeChain(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )

export class ListingChain extends Schema.Class<ListingChain>("@rawr/domain/ListingChain")({
  chainCode: Schema.NonEmptyString,
  exchangeChainCode: Schema.NonEmptyString,
  exchangeChainName: Schema.String,
  withdrawEnabled: Schema.Boolean,
  depositEnabled: Schema.Boolean
}) {}

export type ListingChainEncoded = typeof ListingChain["Encoded"]

export const decodeListingChain = Schema.decodeUnknownEffect(ListingChain)

export const encodeListingChain = Schema.encodeEffect(ListingChain)

export const parseListingChain = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<ListingChain, InvalidCoinError, typeof ListingChain["DecodingServices"]> =>
  decodeListingChain(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )
