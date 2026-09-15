import { Effect, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { CmcId, Symbol } from "@rawr/domain"
import { getCoin, listCoins, setCoinStatus, upsertCoin } from "./cryptocurrency.js"
import { db, pool } from "./db.js"

// Parsed (not asserted): decodeUnknownSync establishes the brands.
const cmcId = Schema.decodeUnknownSync(CmcId)(921001)

const otherId = Schema.decodeUnknownSync(CmcId)(921002)

const symbol = Schema.decodeUnknownSync(Symbol)("TST9")

afterAll(async () => {
  await pool.end()
})

describe("cryptocurrency repository", () => {
  it("upserts a coin and reads it back", async () => {
    await Effect.runPromise(
      upsertCoin(db, { cmcId, symbol, name: "Test Nine", slug: "test-nine", logo: "https://example.invalid/t9.png" })
    )
    // Explicit status write: upsert preserves existing status, so reset keeps
    // this test idempotent across runs against the shared Postgres.
    const persisted = await Effect.runPromise(setCoinStatus(db, cmcId, "active", "test reset"))

    expect(persisted.cmcId).toBe(cmcId)
    expect(persisted.symbol).toBe("TST9")
    expect(persisted.status).toBe("active")

    const read = await Effect.runPromise(getCoin(db, cmcId))

    expect(read.name).toBe("Test Nine")
    expect(read.slug).toBe("test-nine")
  })

  it("keeps status across re-upsert", async () => {
    await Effect.runPromise(
      upsertCoin(db, { cmcId, symbol, name: "Test Nine", slug: "test-nine", logo: "https://example.invalid/t9.png" })
    )
    await Effect.runPromise(setCoinStatus(db, cmcId, "inactive", "delisted in test"))

    const persisted = await Effect.runPromise(
      upsertCoin(db, { cmcId, symbol, name: "Test Nine v2", slug: "test-nine", logo: "https://example.invalid/t9.png" })
    )

    expect(persisted.name).toBe("Test Nine v2")
    expect(persisted.status).toBe("inactive")
    expect(persisted.reason).toBe("delisted in test")
  })

  it("lists coins filtered by status", async () => {
    const otherSymbol = Schema.decodeUnknownSync(Symbol)("TSO9")
    await Effect.runPromise(
      upsertCoin(db, { cmcId: otherId, symbol: otherSymbol, name: "Test Other", slug: "test-other", logo: "" })
    )

    const inactive = await Effect.runPromise(listCoins(db, "inactive"))

    expect(inactive.map((coin) => coin.cmcId)).toContain(cmcId)

    const all = await Effect.runPromise(listCoins(db))

    expect(all.map((coin) => coin.cmcId)).toEqual(expect.arrayContaining([cmcId, otherId]))
  })

  it("fails typed on a missing coin", async () => {
    const missing = Schema.decodeUnknownSync(CmcId)(929999)

    const getError = await Effect.runPromise(Effect.flip(getCoin(db, missing)))

    expect(getError._tag).toBe("CoinNotFound")

    const statusError = await Effect.runPromise(Effect.flip(setCoinStatus(db, missing, "inactive", "nope")))

    expect(statusError._tag).toBe("CoinNotFound")
  })
})
