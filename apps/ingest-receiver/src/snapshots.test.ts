import { Effect, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { CmcId, parseOrderbookTick } from "@rawr/domain"
import { insertCrypto, insertListing } from "@rawr/coin-admin-api"
import { saveSnapshot } from "./snapshots.js"
import { db, pool } from "./db.js"

// Parsed (not asserted): decodeUnknownSync establishes the CmcId brand.
const cmcId = Schema.decodeUnknownSync(CmcId)(920001)

const now = new Date("2026-09-14T08:00:00.000Z")

afterAll(async () => {
  await pool.end()
})

describe("exchange snapshots", () => {
  it("persists a snapshot without error", async () => {
    const cryptoId = await Effect.runPromise(insertCrypto(cmcId, "TST3"))
    await Effect.runPromise(insertListing(cryptoId, "binance", true))

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
