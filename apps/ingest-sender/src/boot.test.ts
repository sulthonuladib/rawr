import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { AdminApiLive, CmcId, makeCoinAdminClient, Symbol } from "@rawr/coin-admin-api"
import { loadActiveCoins } from "./index.js"

// Parsed (not asserted): decodeUnknownSync establishes the brands.
const cmcId = Schema.decodeUnknownSync(CmcId)(927001)

const symbol = Schema.decodeUnknownSync(Symbol)("TSTB")

const bootPort = 4022

describe("sender boot", () => {
  it("loads the active coin list from the running admin API", async () => {
    const coins = await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        yield* Layer.build(AdminApiLive(bootPort))

        const client = makeCoinAdminClient({ baseUrl: `http://localhost:${bootPort}` })

        yield* client.upsertCoin({ cmcId, symbol, name: "Boot Coin", slug: "boot-coin", logo: "" })
        // Reset: upsert preserves status, so re-activate explicitly to keep
        // this test idempotent across runs against the shared Postgres.
        yield* client.setCoinStatus(cmcId, "active", "boot test")

        const active = yield* loadActiveCoins(client)

        expect(active.map((coin) => coin.cmcId)).toContain(cmcId)

        yield* client.setCoinStatus(cmcId, "inactive", "boot test")

        const afterDeactivate = yield* loadActiveCoins(client)

        expect(afterDeactivate.map((coin) => coin.cmcId)).not.toContain(cmcId)

        return afterDeactivate
      }))
    )

    expect(coins.map((coin) => coin.cmcId)).not.toContain(cmcId)
  })
})
