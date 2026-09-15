import { Effect } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { getExchange, listExchanges } from "./exchange.js"
import { db, pool } from "./db.js"
import { EXCHANGE_SEED } from "./schema.js"

afterAll(async () => {
  await pool.end()
})

describe("exchange repository", () => {
  it("lists all seeded exchanges", async () => {
    const rows = await Effect.runPromise(listExchanges(db))

    expect(rows.map((row) => row.slug)).toEqual(
      expect.arrayContaining(EXCHANGE_SEED.map((seed) => seed.slug))
    )
    expect(rows).toHaveLength(EXCHANGE_SEED.length)
  })

  it("resolves an exchange by domain value", async () => {
    const binance = await Effect.runPromise(getExchange(db, "binance"))

    expect(binance.slug).toBe("binance")
    expect(binance.name).toBe("Binance")
  })

  it("maps upbitUsdt to the upbit_usdt slug", async () => {
    const upbitUsdt = await Effect.runPromise(getExchange(db, "upbitUsdt"))

    expect(upbitUsdt.slug).toBe("upbit_usdt")
  })
})
