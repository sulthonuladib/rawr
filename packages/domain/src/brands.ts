import { Schema } from "effect"

export const CmcId = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("CmcId")
)

export type CmcId = typeof CmcId["Type"]

export type CmcIdEncoded = typeof CmcId["Encoded"]

export const Symbol = Schema.NonEmptyString.pipe(Schema.brand("Symbol"))

export type Symbol = typeof Symbol["Type"]

export type SymbolEncoded = typeof Symbol["Encoded"]

export const AlternateSymbol = Schema.String.pipe(Schema.brand("AlternateSymbol"))

export type AlternateSymbol = typeof AlternateSymbol["Type"]

export type AlternateSymbolEncoded = typeof AlternateSymbol["Encoded"]

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

export const Exchange = Schema.Literals(Exchanges)

export type Exchange = typeof Exchange["Type"]

export type ExchangeEncoded = typeof Exchange["Encoded"]
