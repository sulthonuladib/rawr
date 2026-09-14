/**
 * Boundary parse tests for the chain domain (`Chain`, `ListingChain`,
 * `TransferSpeed`).
 *
 * Pure Schema edges — no database. Valid shapes decode; corrupt rows fail as
 * `InvalidCoinError` in the Effect channel; `deriveTransferSpeed` covers the
 * unknown / available / unavailable cases from the spec.
 */
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { deriveTransferSpeed, parseChain, parseListingChain } from "./chain.js"

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

describe("deriveTransferSpeed", () => {
  it("reports unknown when there are no chains", () => {
    expect(deriveTransferSpeed([])).toBe("unknown")
  })

  it("reports available when any chain is fully enabled", async () => {
    const chains = await Effect.runPromise(
      Effect.forEach(
        [
          { chainCode: "BTC", exchangeChainCode: "BTC", exchangeChainName: "", withdrawEnabled: false, depositEnabled: false },
          { chainCode: "ETH", exchangeChainCode: "ETH", exchangeChainName: "", withdrawEnabled: true, depositEnabled: true }
        ],
        parseListingChain
      )
    )

    expect(deriveTransferSpeed(chains)).toBe("available")
  })

  it("reports unavailable when all withdrawals are disabled", async () => {
    const chains = await Effect.runPromise(
      Effect.forEach(
        [
          { chainCode: "BTC", exchangeChainCode: "BTC", exchangeChainName: "", withdrawEnabled: false, depositEnabled: true },
          { chainCode: "TRX", exchangeChainCode: "TRX", exchangeChainName: "", withdrawEnabled: false, depositEnabled: false }
        ],
        parseListingChain
      )
    )

    expect(deriveTransferSpeed(chains)).toBe("unavailable")
  })
})
