/**
 * `@rawr/domain/coin` — the `ActiveCoin` aggregate and its edge parser.
 *
 * Coin shape: `symbol`, `cmcId`, `name`, `slug`, `logo`, `reason`
 * (`""` default), `transferSpeed` (`""` default), plus per exchange a boolean
 * flag and an `<exchange>AlternateSymbol` string (`""` default). The domain normalizes each flat pair into one
 * `ExchangeListing` (`{ enabled, alternate }`) keyed by the exchange name, so
 * services iterate `Exchanges` instead of touching 30 columns. The
 * `coin-store` package maps this back to flat Drizzle columns.
 *
 * @module
 */
import { Effect, Schema } from "effect"
import { AlternateSymbol, CmcId, Symbol } from "./brands.js"
import { InvalidCoinError } from "./errors.js"

/**
 * Per-exchange listing: whether the coin is tracked there plus an optional
 * symbol override (`""` means no override).
 */
export const ExchangeListing = Schema.Struct({
  enabled: Schema.Boolean,
  alternate: AlternateSymbol
})

/** Type-level `ExchangeListing` (`{ enabled, alternate }`). */
export type ExchangeListing = typeof ExchangeListing["Type"]

/** Encoded (wire) representation of `ExchangeListing`. */
export type ExchangeListingEncoded = typeof ExchangeListing["Encoded"]

/**
 * A listed coin with its 15 per-exchange listings.
 *
 * `reason` / `transferSpeed` stay required `String`s (possibly `""`) to avoid
 * `exactOptionalPropertyTypes` friction.
 */
export class ActiveCoin extends Schema.Class<ActiveCoin>("@rawr/domain/ActiveCoin")({
  symbol: Symbol,
  cmcId: CmcId,
  name: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  logo: Schema.NonEmptyString,
  reason: Schema.String,
  transferSpeed: Schema.String,
  binance: ExchangeListing,
  indodax: ExchangeListing,
  huobi: ExchangeListing,
  bybit: ExchangeListing,
  okx: ExchangeListing,
  kucoin: ExchangeListing,
  mexc: ExchangeListing,
  bittime: ExchangeListing,
  bitget: ExchangeListing,
  gateio: ExchangeListing,
  upbit: ExchangeListing,
  upbitUsdt: ExchangeListing,
  pintu: ExchangeListing,
  reku: ExchangeListing,
  bitmart: ExchangeListing
}) {}

/** Encoded (wire) representation of `ActiveCoin`. */
export type ActiveCoinEncoded = typeof ActiveCoin["Encoded"]

/**
 * Reusable decoder for `ActiveCoin` (defined once at module load, called at
 * edges). Fails with `SchemaError`; use `parseActiveCoin` in `Effect` code to
 * get the domain `InvalidCoinError` instead.
 */
export const decodeActiveCoin = Schema.decodeUnknownEffect(ActiveCoin)

/**
 * Reusable encoder for `ActiveCoin` (domain value back to wire format).
 */
export const encodeActiveCoin = Schema.encodeEffect(ActiveCoin)

/**
 * Parse unknown edge input into an `ActiveCoin`.
 *
 * Maps `SchemaError` into `InvalidCoinError` so the failure stays in the
 * `Effect` channel as a value — never `throw`.
 *
 * @param input untrusted input from an HTTP/WS/AMQP boundary
 * @returns the decoded coin, or `InvalidCoinError`
 */
export const parseActiveCoin = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<ActiveCoin, InvalidCoinError, typeof ActiveCoin["DecodingServices"]> =>
  decodeActiveCoin(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )
