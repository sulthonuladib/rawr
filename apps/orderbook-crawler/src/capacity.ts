import type { Exchange } from "@rawr/domain"

export const MaxSubsPerSocket: Record<Exchange, number | null> = {
  binance: 1,
  indodax: 70,
  huobi: 1,
  bybit: 100,
  okx: 30,
  kucoin: 100,
  mexc: 20,
  bittime: 50,
  bitget: 30,
  gateio: 100,
  upbit: null,
  upbitUsdt: null,
  pintu: null,
  reku: 1,
  bitmart: 100
}

export const maxSubsFor = (exchange: Exchange): number | null => {
  const found = MaxSubsPerSocket[exchange]

  return found
}

export const isImplemented = (exchange: Exchange): boolean => maxSubsFor(exchange) !== null

export const ImplementedExchanges: ReadonlyArray<Exchange> = [
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
  "reku",
  "bitmart"
]

export const UnimplementedExchanges: ReadonlyArray<Exchange> = ["upbit", "upbitUsdt", "pintu"]
