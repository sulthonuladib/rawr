/**
 * Repository tests for `chains` + `exchange_cryptocurrency_chain`.
 *
 * Live Postgres (`DATABASE_URL`, else the local default). Fixtures use the
 * 91000x `cmcId` range and `TS…` chain codes so files and reruns cannot
 * collide; inserts are idempotent and nothing is ever deleted.
 */
import { Effect } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { CmcId } from "@rawr/domain"
import {
  getTransferSpeed,
  listChains,
  listListingChains,
  updateListingChainFlags,
  upsertChain,
  upsertListingChain
} from "./chains.js"
import { parseChain } from "@rawr/domain"
import { db, pool } from "./db.js"
import { insertCrypto, insertListing } from "./fixtures.js"

const cmcId = 910001 as CmcId

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
  it("upserts flags, updates them, and derives transfer speed", async () => {
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
    expect(await Effect.runPromise(getTransferSpeed(db, cmcId, "binance"))).toBe("available")

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
    expect(await Effect.runPromise(getTransferSpeed(db, cmcId, "binance"))).toBe("unavailable")

    const rows = await Effect.runPromise(listListingChains(db, cmcId, "binance"))

    expect(rows.map((row) => row.chainCode)).toContain("TSBTC")
  })

  it("reports unknown speed for a listing with no chains", async () => {
    const otherId = 910002 as CmcId
    const cryptoId = await Effect.runPromise(insertCrypto(otherId, "TS2"))
    await Effect.runPromise(insertListing(cryptoId, "bybit", true))

    expect(await Effect.runPromise(getTransferSpeed(db, otherId, "bybit"))).toBe("unknown")
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
    const missing = 919999 as CmcId
    const error = await Effect.runPromise(Effect.flip(listListingChains(db, missing, "binance")))

    expect(error._tag).toBe("CoinNotFound")
  })
})
