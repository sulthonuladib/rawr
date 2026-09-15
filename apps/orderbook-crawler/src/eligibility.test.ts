import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Cryptocurrency, Listing } from "@rawr/coin-admin-api"
import { filterEligible } from "./eligibility.js"

const coinOf = (
  cmcId: number,
  symbol: string,
  status: "active" | "inactive"
): Cryptocurrency =>
  Schema.decodeUnknownSync(Cryptocurrency)({
    cmcId,
    symbol,
    name: `${symbol} Coin`,
    slug: `${symbol.toLowerCase()}-coin`,
    logo: "",
    status,
    reason: "test"
  })

const listingOf = (
  cmcId: number,
  exchange: Listing["exchange"],
  enabled: boolean,
  alternateSymbol = ""
): Listing =>
  Schema.decodeUnknownSync(Listing)({
    cmcId,
    exchange,
    enabled,
    alternateSymbol
  })

describe("arbitrage eligibility gate", () => {
  it("excludes inactive coins", () => {
    const coins = [coinOf(1, "BTC", "inactive")]

    const listings = [listingOf(1, "binance", true), listingOf(1, "bybit", true)]

    expect(filterEligible(coins, listings, "binance")).toHaveLength(0)
  })

  it("excludes coins enabled on fewer than two exchanges", () => {
    const coins = [coinOf(2, "ETH", "active")]

    const listings = [listingOf(2, "binance", true), listingOf(2, "bybit", false)]

    expect(filterEligible(coins, listings, "binance")).toHaveLength(0)
  })

  it("includes only coins active and enabled here and elsewhere", () => {
    const coins = [coinOf(3, "SOL", "active"), coinOf(4, "DOGE", "active")]

    const listings = [
      listingOf(3, "binance", true),
      listingOf(3, "bybit", true),
      listingOf(4, "binance", true),
      listingOf(4, "bybit", false)
    ]

    const eligible = filterEligible(coins, listings, "binance")

    expect(eligible.map((coin) => Number(coin.cmcId))).toEqual([3])
  })

  it("prefers alternate wire symbol with fallback to coin symbol", () => {
    const coins = [coinOf(5, "BTC", "active")]

    const listings = [listingOf(5, "binance", true, "BTCUSDT"), listingOf(5, "bybit", true)]

    const eligible = filterEligible(coins, listings, "binance")

    expect(eligible[0]?.wireSymbol).toBe("BTCUSDT")

    const fallbackListings = [listingOf(5, "bybit", true, "BTCUSDT"), listingOf(5, "binance", true)]

    const fallback = filterEligible(coins, fallbackListings, "binance")

    expect(fallback[0]?.wireSymbol).toBe("BTC")
  })
})
