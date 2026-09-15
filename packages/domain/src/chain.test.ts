import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { parseChain, parseListingChain } from "./chain.js"

describe("parseChain", () => {
  it("decodes a valid chain", async () => {
    const chain = await Effect.runPromise(parseChain({ code: "BTC", name: "Bitcoin" }))

    expect(chain.code).toBe("BTC")
    expect(chain.name).toBe("Bitcoin")
  })

  it("fails typed on a corrupt row (empty code)", async () => {
    const error = await Effect.runPromise(Effect.flip(parseChain({ code: "", name: "Bitcoin" })))

    expect(error._tag).toBe("InvalidCoinError")
  })
})

describe("parseListingChain", () => {
  it("decodes a valid listing chain", async () => {
    const row = await Effect.runPromise(
      parseListingChain({
        chainCode: "ETH",
        exchangeChainCode: "ETH",
        exchangeChainName: "",
        withdrawEnabled: true,
        depositEnabled: true
      })
    )

    expect(row.chainCode).toBe("ETH")
    expect(row.withdrawEnabled).toBe(true)
  })

  it("fails typed on a corrupt row (non-boolean flag)", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        parseListingChain({
          chainCode: "ETH",
          exchangeChainCode: "ETH",
          exchangeChainName: "",
          withdrawEnabled: "yes",
          depositEnabled: true
        })
      )
    )

    expect(error._tag).toBe("InvalidCoinError")
  })
})

