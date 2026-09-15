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
      baseUrl: "http://localhost:4100",
      fetchFn: stubFetch(new Response(JSON.stringify([coinJson]), { status: 200 }))
    })

    const coins = await Effect.runPromise(client.listCoins("active"))

    expect(coins.map((coin) => coin.symbol)).toEqual(["BTC"])
  })

  it("maps server errors with status", async () => {
    const client = makeCoinAdminClient({
      baseUrl: "http://localhost:4100",
      fetchFn: stubFetch(new Response(JSON.stringify({ error: "no coin" }), { status: 404 }))
    })

    const error = await Effect.runPromise(Effect.flip(client.listCoins()))

    expect(error).toBeInstanceOf(ClientError)
    expect(error.status).toBe(404)
    expect(error.message).toBe("no coin")
  })

  it("maps network failures without status", async () => {
    const client = makeCoinAdminClient({
      baseUrl: "http://localhost:4100",
      fetchFn: failingFetch()
    })

    const error = await Effect.runPromise(Effect.flip(client.listCoins()))

    expect(error).toBeInstanceOf(ClientError)
    expect(error.status).toBeUndefined()
    expect(error.message).toContain("socket hang up")
  })

  it("requests the snake_case slug for special exchanges", async () => {
    let seenUrl = ""

    const client = makeCoinAdminClient({
      baseUrl: "http://localhost:4100",
      fetchFn: (input: string | URL | Request, _init?: RequestInit) => {
        seenUrl = String(input)

        return Promise.resolve(
          new Response(JSON.stringify({ slug: "upbit_usdt", name: "Upbit USDT" }), { status: 200 })
        )
      }
    })

    const exchange = await Effect.runPromise(client.getExchange("upbitUsdt"))

    expect(seenUrl).toBe("http://localhost:4100/exchanges/upbit_usdt")
    expect(exchange.slug).toBe("upbit_usdt")
  })
})
