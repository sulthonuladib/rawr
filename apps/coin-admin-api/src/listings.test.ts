import { Effect, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { AlternateSymbol, CmcId } from "@rawr/domain"
import { getListing, listListings, setAlternateSymbol, setListingEnabled } from "./listings.js"
import { db, pool } from "./db.js"
import { insertCrypto, insertListing } from "./fixtures.js"

// Parsed (not asserted): decodeUnknownSync establishes the brands.
const cmcId = Schema.decodeUnknownSync(CmcId)(923001)

const alternate = Schema.decodeUnknownSync(AlternateSymbol)("TST9X")

afterAll(async () => {
  await pool.end()
})

describe("listing repository", () => {
  it("disables a listing without deleting the row", async () => {
    const cryptoId = await Effect.runPromise(insertCrypto(db, cmcId, "TST9L"))
    await Effect.runPromise(insertListing(db, cryptoId, "binance", true))

    const disabled = await Effect.runPromise(setListingEnabled(db, cmcId, "binance", false))

    expect(disabled.enabled).toBe(false)
    expect(disabled.cmcId).toBe(cmcId)
    expect(disabled.exchange).toBe("binance")

    const read = await Effect.runPromise(getListing(db, cmcId, "binance"))

    expect(read.enabled).toBe(false)

    const rows = await Effect.runPromise(listListings(db, { cmcId }))

    expect(rows.map((row) => row.exchange)).toContain("binance")
  })

  it("round-trips the alternate symbol", async () => {
    const updated = await Effect.runPromise(setAlternateSymbol(db, cmcId, "binance", alternate))

    expect(updated.alternateSymbol).toBe("TST9X")

    const enabled = await Effect.runPromise(
      listListings(db, { cmcId, exchange: "binance", enabled: false })
    )

    expect(enabled).toHaveLength(1)
  })

  it("fails typed on a missing listing", async () => {
    const missing = Schema.decodeUnknownSync(CmcId)(939999)

    const error = await Effect.runPromise(Effect.flip(getListing(db, missing, "binance")))

    expect(error._tag).toBe("CoinNotFound")
  })
})
