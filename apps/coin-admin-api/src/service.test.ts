import { asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { CmcId, parseCoinUpdated, Symbol } from "@rawr/domain"
import { CoinAdmin } from "./service.js"
import { db, pool } from "./db.js"
import { coinOutbox } from "./schema.js"

// Parsed (not asserted): decodeUnknownSync establishes the brands.
const cmcId = Schema.decodeUnknownSync(CmcId)(924001)

const missing = Schema.decodeUnknownSync(CmcId)(949999)

const symbol = Schema.decodeUnknownSync(Symbol)("TSTSV")

const adminLayer = CoinAdmin.layer(db)

const readOutbox = (id: number) =>
  Effect.tryPromise({
    try: () => db.select().from(coinOutbox).where(eq(coinOutbox.cmcId, id)).orderBy(asc(coinOutbox.id)),
    catch: (cause) => new Error(`readOutbox: postgres unavailable (${String(cause)})`)
  })

afterAll(async () => {
  await pool.end()
})

describe("CoinAdmin status changes", () => {
  it("writes the coin update and outbox row together", async () => {
    const { coin, rows } = await Effect.runPromise(
      Effect.gen(function*() {
        const admin = yield* CoinAdmin

        yield* admin.upsertCoin({ cmcId, symbol, name: "Service Nine", slug: "service-nine", logo: "" })

        const coin = yield* admin.setStatus(cmcId, "inactive", "service test")
        const rows = yield* readOutbox(cmcId)

        return { coin, rows }
      }).pipe(Effect.provide(adminLayer))
    )

    expect(coin.status).toBe("inactive")
    expect(coin.reason).toBe("service test")

    const last = rows.at(-1)

    // sentAt-null is asserted in relay.test.ts before relaying: the relay
    // drains every unsent row, so this file only asserts the row was written.
    const event = await Effect.runPromise(parseCoinUpdated(last?.payload))

    expect(event.cmcId).toBe(cmcId)
    expect(event.status._tag).toBe("Inactive")
    expect(event.reason).toBe("service test")
  })

  it("writes no outbox row when the coin is missing", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function*() {
        const admin = yield* CoinAdmin

        return yield* Effect.flip(admin.setStatus(missing, "inactive", "nope"))
      }).pipe(Effect.provide(adminLayer))
    )

    expect(error._tag).toBe("CoinNotFound")

    const rows = await Effect.runPromise(readOutbox(missing))

    expect(rows).toHaveLength(0)
  })

  it("appends a second outbox row on reactivate", async () => {
    const { before, after } = await Effect.runPromise(
      Effect.gen(function*() {
        const admin = yield* CoinAdmin
        const before = yield* readOutbox(cmcId)

        yield* admin.setStatus(cmcId, "active", "")

        const after = yield* readOutbox(cmcId)

        return { before, after }
      }).pipe(Effect.provide(adminLayer))
    )

    expect(after.length).toBe(before.length + 1)

    const event = await Effect.runPromise(parseCoinUpdated(after.at(-1)?.payload))

    expect(event.status._tag).toBe("Active")
  })
})
