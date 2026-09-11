/**
 * `@rawr/domain/brands` — branded primitives and the 15-exchange union.
 *
 * Legacy source of truth: `~/Tools/coin-lister-service/src/models/ActiveCoin.js`
 * and `~/Tools/cmc-aggregator/models/ActiveCoin.model.ts` (read-only). Both
 * define the same 15 exchange flags, each with a boolean plus an
 * `<exchange>AlternateSymbol` string. This module captures that exact set as
 * a `Schema` union so HTTP/WS/AMQP edges parse instead of validate.
 *
 * @module
 */
import { Schema } from "effect"

/**
 * CoinMarketCap numeric id: a branded positive integer.
 *
 * Runtime-checked (`Int` + `> 0`); the brand is nominal so `CmcId` cannot be
 * confused with a plain `number` at the type level.
 */
export const CmcId = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("CmcId")
)

/** Type-level `CmcId` (a `number` branded `"CmcId"`). */
export type CmcId = typeof CmcId["Type"]

/** Encoded (wire) representation of `CmcId`. */
export type CmcIdEncoded = typeof CmcId["Encoded"]

/**
 * Canonical coin symbol (e.g. `"BTC"`): a branded non-empty string.
 *
 * Runtime-checked via `NonEmptyString`; the brand keeps symbols distinct from
 * arbitrary strings.
 */
export const Symbol = Schema.NonEmptyString.pipe(Schema.brand("Symbol"))

/** Type-level `Symbol` (a `string` branded `"Symbol"`). */
export type Symbol = typeof Symbol["Type"]

/** Encoded (wire) representation of `Symbol`. */
export type SymbolEncoded = typeof Symbol["Encoded"]

/**
 * Per-exchange alternate symbol override (e.g. `"BTCIDR"` on Indodax).
 *
 * Legacy stores `""` when there is no override, so the empty string is valid
 * here — unlike `Symbol`. Branded for nominal safety, no extra runtime check
 * beyond `String`.
 */
export const AlternateSymbol = Schema.String.pipe(Schema.brand("AlternateSymbol"))

/** Type-level `AlternateSymbol` (a `string` branded `"AlternateSymbol"`). */
export type AlternateSymbol = typeof AlternateSymbol["Type"]

/** Encoded (wire) representation of `AlternateSymbol`. */
export type AlternateSymbolEncoded = typeof AlternateSymbol["Encoded"]

/**
 * Exact 15 exchanges from the legacy `ActiveCoin` models, in legacy field
 * order.
 *
 * Note the `upbitUsdt` entry: the Mongoose field is camelCase `upbitUsdt`
 * while the AMQP queue name is `upbit_usdt` (see
 * `~/Tools/exchange-receiver-websocket/src/amqp.js`). The domain keeps the
 * model spelling; adapters map the wire name at the edge.
 */
export const Exchanges = [
  "binance",
  "indodax",
  "huobi",
  "bybit",
  "okx",
  "kucoin",
  "mexc",
  "bittime",
  "bitget",
  "gateio",
  "upbit",
  "upbitUsdt",
  "pintu",
  "reku",
  "bitmart"
] as const

/**
 * Exchange union schema: exactly one of the 15 legacy exchange keys.
 *
 * Decode at every edge (HTTP query/path, WS payload, AMQP routing key) so an
 * unknown exchange fails in the `Effect` channel, never via `throw`.
 */
export const Exchange = Schema.Literals(Exchanges)

/** Type-level `Exchange` (one of the 15 legacy exchange keys). */
export type Exchange = typeof Exchange["Type"]

/** Encoded (wire) representation of `Exchange`. */
export type ExchangeEncoded = typeof Exchange["Encoded"]
