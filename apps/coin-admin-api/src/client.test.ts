import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ClientError, makeCoinAdminClient } from "./client.js"

const coinJson = {
  cmcId: 1,
  symbol: "BTC",
  name: "Bitcoin",
  slug: "bitcoin",
  logo: "",
  status: "active",
  reason: ""
}

const stubFetch = (response: Response): typeof fetch =>
  (_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(response)

const failingFetch = (): typeof fetch =>
  (_input: string | URL | Request, _init?: RequestInit) => Promise.reject(new Error("socket hang up"))

describe("coin admin client", () => {
  it("decodes the coin list", async () => {
    const client = makeCoinAdminClient({
      baseUrl: "http://localhost:4000",
      fetchFn: stubFetch(new Response(JSON.stringify([coinJson]), { status: 200 }))
    })

    const coins = await Effect.runPromise(client.listCoins("active"))

    expect(coins.map((coin) => coin.symbol)).toEqual(["BTC"])
  })

  it("maps server errors with status", async () => {
    const client = makeCoinAdminClient({
      baseUrl: "http://localhost:4000",
      fetchFn: stubFetch(new Response(JSON.stringify({ error: "no coin" }), { status: 404 }))
    })

    const error = await Effect.runPromise(Effect.flip(client.listCoins()))

    expect(error).toBeInstanceOf(ClientError)
    expect(error.status).toBe(404)
    expect(error.message).toBe("no coin")
  })

  it("maps network failures without status", async () => {
    const client = makeCoinAdminClient({
      baseUrl: "http://localhost:4000",
      fetchFn: failingFetch()
    })

    const error = await Effect.runPromise(Effect.flip(client.listCoins()))

    expect(error).toBeInstanceOf(ClientError)
    expect(error.status).toBeUndefined()
    expect(error.message).toContain("socket hang up")
  })
})
