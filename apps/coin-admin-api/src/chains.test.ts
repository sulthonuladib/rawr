import { Effect, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { CmcId } from "@rawr/domain"
import {
  listChains,
  listListingChains,
  updateListingChainFlags,
  upsertChain,
  upsertListingChain
} from "./chains.js"
import { parseChain } from "@rawr/domain"
import { db, pool } from "./db.js"
import { insertCrypto, insertListing } from "./fixtures.js"

// Parsed (not asserted): decodeUnknownSync establishes the CmcId brand.
const cmcId = Schema.decodeUnknownSync(CmcId)(910001)

afterAll(async () => {
  await pool.end()
})

describe("chain registry", () => {
  it("upserts a chain and lists it back", async () => {
    const chain = await Effect.runPromise(parseChain({ code: "TSNET", name: "Testnet" }))
    const persisted = await Effect.runPromise(upsertChain(db, chain))

    expect(persisted.code).toBe("TSNET")
    expect(persisted.name).toBe("Testnet")

    const chains = await Effect.runPromise(listChains(db))

    expect(chains.some((entry) => entry.code === "TSNET")).toBe(true)
  })

  it("updates the name on re-upsert", async () => {
    const chain = await Effect.runPromise(parseChain({ code: "TSNET", name: "Testnet v2" }))
    const persisted = await Effect.runPromise(upsertChain(db, chain))

    expect(persisted.name).toBe("Testnet v2")
  })
})

describe("listing chains", () => {
  it("upserts flags, updates them, and lists raw flags", async () => {
    const cryptoId = await Effect.runPromise(insertCrypto(cmcId, "TST"))
    await Effect.runPromise(insertListing(cryptoId, "binance", true))

    const chain = await Effect.runPromise(parseChain({ code: "TSBTC", name: "Test Bitcoin" }))
    await Effect.runPromise(upsertChain(db, chain))

    const upserted = await Effect.runPromise(
      upsertListingChain(db, {
        cmcId,
        exchange: "binance",
        chainCode: "TSBTC",
        exchangeChainCode: "TSBTC",
        exchangeChainName: "",
        withdrawEnabled: true,
        depositEnabled: true
      })
    )

    expect(upserted.withdrawEnabled).toBe(true)
    expect(upserted.depositEnabled).toBe(true)

    const listedAfterUpsert = await Effect.runPromise(listListingChains(db, cmcId, "binance"))
    const upsertedRow = listedAfterUpsert.find((row) => row.chainCode === "TSBTC")

    expect(upsertedRow?.withdrawEnabled).toBe(true)
    expect(upsertedRow?.depositEnabled).toBe(true)

    const updated = await Effect.runPromise(
      updateListingChainFlags(db, {
        cmcId,
        exchange: "binance",
        chainCode: "TSBTC",
        exchangeChainCode: "TSBTC",
        exchangeChainName: "",
        withdrawEnabled: false,
        depositEnabled: true
      })
    )

    expect(updated.withdrawEnabled).toBe(false)
    expect(updated.depositEnabled).toBe(true)

    const rows = await Effect.runPromise(listListingChains(db, cmcId, "binance"))
    const updatedRow = rows.find((row) => row.chainCode === "TSBTC")

    expect(updatedRow?.withdrawEnabled).toBe(false)
    expect(updatedRow?.depositEnabled).toBe(true)
    expect(rows.map((row) => row.chainCode)).toContain("TSBTC")
  })

  it("returns no rows for a listing with no chains", async () => {
    const otherId = Schema.decodeUnknownSync(CmcId)(910002)

    const cryptoId = await Effect.runPromise(insertCrypto(otherId, "TS2"))
    await Effect.runPromise(insertListing(cryptoId, "bybit", true))

    const rows = await Effect.runPromise(listListingChains(db, otherId, "bybit"))

    expect(rows).toEqual([])
  })

  it("fails typed on an unknown chain code", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        upsertListingChain(db, {
          cmcId,
          exchange: "binance",
          chainCode: "NOPE",
          exchangeChainCode: "NOPE",
          exchangeChainName: "",
          withdrawEnabled: true,
          depositEnabled: true
        })
      )
    )

    expect(error._tag).toBe("InvalidCoinError")
  })

  it("fails typed on a missing listing", async () => {
    const missing = Schema.decodeUnknownSync(CmcId)(919999)

    const error = await Effect.runPromise(Effect.flip(listListingChains(db, missing, "binance")))

    expect(error._tag).toBe("CoinNotFound")
  })
})
