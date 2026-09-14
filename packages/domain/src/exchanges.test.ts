import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { exchangeToSlug, slugToExchange } from "./exchanges.js"

describe("exchangeToSlug", () => {
  it("maps upbitUsdt to the snake_case slug", () => {
    expect(exchangeToSlug("upbitUsdt")).toBe("upbit_usdt")
  })

  it("leaves other exchanges as identity", () => {
    expect(exchangeToSlug("binance")).toBe("binance")
  })
})

describe("slugToExchange", () => {
  it("maps upbit_usdt back to the domain value", async () => {
    const exchange = await Effect.runPromise(slugToExchange("upbit_usdt"))

    expect(exchange).toBe("upbitUsdt")
  })

  it("leaves other slugs as identity", async () => {
    const exchange = await Effect.runPromise(slugToExchange("binance"))

    expect(exchange).toBe("binance")
  })

  it("fails typed on an unknown slug", async () => {
    const error = await Effect.runPromise(Effect.flip(slugToExchange("nyse")))

    expect(error._tag).toBe("InvalidCoinError")
  })
})
