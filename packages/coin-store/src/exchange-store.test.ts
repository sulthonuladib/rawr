/**
 * Repository tests for `exchange_snapshots` + `exchange_opportunities`.
 *
 * Live Postgres (`DATABASE_URL`, else the local default). Fixtures use the
 * 92000x `cmcId` range so files and reruns cannot collide; inserts are
 * idempotent and nothing is ever deleted.
 */
import { Effect, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { CmcId, parseOpportunity, parseOrderbookTick } from "@rawr/domain"
import { listOpportunities, saveOpportunity, saveSnapshot } from "./exchange-store.js"
import { db, pool } from "./db.js"
import { insertCrypto, insertListing } from "./fixtures.js"

// Parsed (not asserted): decodeUnknownSync establishes the CmcId brand.
const cmcId = Schema.decodeUnknownSync(CmcId)(920001)

const now = new Date("2026-09-14T08:00:00.000Z")

afterAll(async () => {
  await pool.end()
})

describe("exchange snapshots and opportunities", () => {
  it("round-trips a snapshot and live opportunities with expiry filtering", async () => {
    const cryptoId = await Effect.runPromise(insertCrypto(cmcId, "TST3"))
    await Effect.runPromise(insertListing(cryptoId, "binance", true))
    await Effect.runPromise(insertListing(cryptoId, "bybit", true))

    const tick = await Effect.runPromise(
      parseOrderbookTick({
        cmcId,
        exchange: "binance",
        symbol: "TST3",
        buyPrice: 100,
        sellPrice: 101,
        buyAmount: 5,
        sellAmount: 5
      })
    )

    await Effect.runPromise(saveSnapshot(db, tick, now))

    const live = await Effect.runPromise(
      parseOpportunity({
        symbol: "TST3",
        cmcId,
        buyExchange: "binance",
        sellExchange: "bybit",
        buyPrice: 100,
        sellPrice: 100.4,
        buyAmount: 5,
        sellAmount: 5,
        profitPercentage: "0.40"
      })
    )

    const stale = await Effect.runPromise(
      parseOpportunity({
        symbol: "TST3",
        cmcId,
        buyExchange: "bybit",
        sellExchange: "binance",
        buyPrice: 100,
        sellPrice: 101,
        buyAmount: 5,
        sellAmount: 5,
        profitPercentage: "1.00"
      })
    )

    await Effect.runPromise(saveOpportunity(db, live, new Date("2026-09-14T09:00:00.000Z")))
    await Effect.runPromise(saveOpportunity(db, stale, new Date("2026-09-14T07:00:00.000Z")))

    const rows = await Effect.runPromise(listOpportunities(db, { limit: 10, now }))

    expect(rows.some((row) => row.opportunity.profitPercentage === "0.4")).toBe(true)
    expect(rows.some((row) => row.opportunity.profitPercentage === "1")).toBe(false)
  })

  it("rejects a non-numeric profit before touching Postgres", async () => {
    // The domain accepts any string profit; the store guards the numeric boundary.
    const opportunity = await Effect.runPromise(
      parseOpportunity({
        symbol: "TST3",
        cmcId,
        buyExchange: "binance",
        sellExchange: "bybit",
        buyPrice: 100,
        sellPrice: 101,
        buyAmount: 5,
        sellAmount: 5,
        profitPercentage: "abc"
      })
    )

    const error = await Effect.runPromise(
      Effect.flip(saveOpportunity(db, opportunity, new Date("2026-09-14T09:00:00.000Z")))
    )

    expect(error._tag).toBe("InvalidCoinError")
  })

  it("fails typed when the coin is missing", async () => {
    const missing = Schema.decodeUnknownSync(CmcId)(929999)

    const tick = await Effect.runPromise(
      parseOrderbookTick({
        cmcId: missing,
        exchange: "binance",
        symbol: "MISSING",
        buyPrice: 1,
        sellPrice: 1,
        buyAmount: 1,
        sellAmount: 1
      })
    )

    const error = await Effect.runPromise(Effect.flip(saveSnapshot(db, tick, now)))

    expect(error._tag).toBe("CoinNotFound")
  })
})
