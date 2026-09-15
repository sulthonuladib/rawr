import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Match, Schema } from "effect"
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"
import { afterAll, describe, expect, it } from "vitest"
import { AlternateSymbol, CmcId, Symbol } from "@rawr/domain"
import { Api } from "./api.js"
import { db, pool } from "./db.js"
import { insertCrypto, insertListing } from "./fixtures.js"
import { RoutesLive } from "./routes.js"
import { CoinAdmin } from "./service.js"

const ErrorBody = Schema.Struct({ error: Schema.String })

const senders = {
  POST: HttpClient.post,
  PUT: HttpClient.put,
  PATCH: HttpClient.patch
} as const

const ServerLive = HttpRouter.serve(RoutesLive, { disableLogger: true })

const ApiLive = Layer.provide(ServerLive, CoinAdmin.layer(db))

const runApi = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function*() {
      yield* Layer.build(ApiLive)

      return yield* effect
    }).pipe(
      Effect.provide(NodeHttpServer.layerTest),
      Effect.scoped
    )
  )

const apiClientEffect = HttpApiClient.make(Api)

type ApiClient = Effect.Success<typeof apiClientEffect>

const runClient = <A, E>(call: (client: ApiClient) => Effect.Effect<A, E>): Promise<A> =>
  runApi(Effect.flatMap(apiClientEffect, call))

const getRaw = (path: string): Promise<{ readonly status: number; readonly text: string }> =>
  runApi(
    Effect.gen(function*() {
      const response = yield* HttpClient.get(path)
      const text = yield* response.text

      return { status: response.status, text }
    })
  )

const sendRaw = (
  method: "POST" | "PUT" | "PATCH",
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- test helper forwards arbitrary JSON fixtures; routes decode below.
  payload: unknown
): Promise<{ readonly status: number; readonly text: string }> =>
  runApi(
    Effect.gen(function*() {
      const response = yield* senders[method](path, { body: HttpBody.jsonUnsafe(payload) })
      const text = yield* response.text

      return { status: response.status, text }
    })
  )

const errorMessage = (text: string): string => {
  const json: unknown = JSON.parse(text)

  return Schema.decodeUnknownSync(ErrorBody)(json).error
}

const symbolOf = (symbol: string) => Schema.decodeUnknownSync(Symbol)(symbol)

afterAll(async () => {
  await pool.end()
})

describe("coin routes", () => {
  it("lists active coins", async () => {
    await Effect.runPromise(insertCrypto(db, Schema.decodeUnknownSync(CmcId)(926001), "TSTH"))

    const body = await runClient((client) => client.Coins.listCoins({ query: { status: "active" } }))

    expect(body.map((coin) => coin.cmcId)).toContain(926001)
  })

  it("upserts a coin over PUT", async () => {
    const cmcId = Schema.decodeUnknownSync(CmcId)(926002)

    const first = await runClient((client) =>
      client.Coins.upsertCoin({
        params: { cmcId },
        payload: { symbol: symbolOf("TSTH2"), name: "Http Two", slug: "http-two", logo: "" }
      })
    )

    expect(first.symbol).toBe("TSTH2")

    const second = await runClient((client) =>
      client.Coins.upsertCoin({
        params: { cmcId },
        payload: { symbol: symbolOf("TSTH2"), name: "Http Two v2", slug: "http-two", logo: "" }
      })
    )

    expect(second.name).toBe("Http Two v2")
  })

  it("rejects an unknown status filter", async () => {
    const { status } = await getRaw("/coins?status=bogus")

    expect(status).toBe(400)
  })

  it("rejects a non-numeric cmcId", async () => {
    const { status } = await sendRaw("PUT", "/coins/abc", {
      symbol: "X",
      name: "X",
      slug: "x",
      logo: ""
    })

    expect(status).toBe(400)
  })

  it("rejects zero and negative cmcIds", async () => {
    const zero = await sendRaw("PUT", "/coins/0", {
      symbol: "X",
      name: "X",
      slug: "x",
      logo: ""
    })

    expect(zero.status).toBe(400)

    const negative = await sendRaw("PUT", "/coins/-7", {
      symbol: "X",
      name: "X",
      slug: "x",
      logo: ""
    })

    expect(negative.status).toBe(400)
  })

  it("changes status over PATCH", async () => {
    const cmcId = Schema.decodeUnknownSync(CmcId)(926003)
    await runClient((client) =>
      client.Coins.upsertCoin({
        params: { cmcId },
        payload: { symbol: symbolOf("TSTH3"), name: "Http Three", slug: "http-three", logo: "" }
      })
    )

    const patched = await runClient((client) =>
      client.Coins.setCoinStatus({
        params: { cmcId },
        payload: { status: "inactive", reason: "route test" }
      })
    )

    expect(patched.status).toBe("inactive")
    expect(patched.reason).toBe("route test")
  })

  it("rejects a malformed status body", async () => {
    const { status } = await sendRaw("PATCH", "/coins/926003/status", {
      status: "archived"
    })

    expect(status).toBe(400)
  })

  it("returns the 404 error envelope for a missing coin", async () => {
    const { status, text } = await sendRaw("PATCH", "/coins/969999/status", {
      status: "inactive",
      reason: "nope"
    })

    expect(status).toBe(404)
    expect(errorMessage(text)).toContain("969999")
  })

  it("surfaces the 404 envelope through the derived client", async () => {
    const error = await runClient((client) =>
      Effect.flip(client.Coins.setCoinStatus({
        params: { cmcId: Schema.decodeUnknownSync(CmcId)(969998) },
        payload: { status: "inactive", reason: "nope" }
      }))
    )

    expect(error._tag).toBe("NotFound")
    expect(Match.value(error).pipe(
      Match.tag("NotFound", (notFound) => notFound.error),
      Match.orElse(() => "unexpected error tag")
    )).toContain("969998")
  })
})

describe("registry reads", () => {
  it("lists exchanges", async () => {
    const body = await runClient((client) => client.Exchanges.listExchanges({}))

    expect(body).toHaveLength(15)
    expect(body.map((row) => row.slug)).toContain("binance")
  })

  it("reads one exchange by its snake_case slug", async () => {
    const body = await runClient((client) =>
      client.Exchanges.getExchange({ params: { exchange: "upbit_usdt" } })
    )

    expect(body.slug).toBe("upbit_usdt")
  })

  it("rejects an unknown exchange slug with the error envelope", async () => {
    const { status, text } = await getRaw("/exchanges/nope")

    expect(status).toBe(400)
    expect(errorMessage(text)).toContain("nope")
  })
})

describe("listing routes", () => {
  it("disables a listing over PATCH", async () => {
    const cmcId = Schema.decodeUnknownSync(CmcId)(926004)
    const cryptoId = await Effect.runPromise(insertCrypto(db, cmcId, "TSTH4"))

    await Effect.runPromise(insertListing(db, cryptoId, "binance", true))

    // Reset: insertListing is insert-only, so re-enable explicitly to keep
    // this test idempotent across runs against the shared Postgres.
    await runClient((client) =>
      client.Listings.patchListing({ params: { cmcId, exchange: "binance" }, payload: { enabled: true } })
    )

    const before = await runClient((client) => client.Listings.listListings({ query: { cmcId } }))

    expect(before.map((row) => row.enabled)).toContain(true)

    const patched = await runClient((client) =>
      client.Listings.patchListing({ params: { cmcId, exchange: "binance" }, payload: { enabled: false } })
    )

    expect(patched.enabled).toBe(false)

    const after = await runClient((client) =>
      client.Listings.listListings({ query: { cmcId, enabled: "false" } })
    )

    expect(after.map((row) => row.exchange)).toContain("binance")
  })

  it("rejects an empty listing patch with the error envelope", async () => {
    const { status, text } = await sendRaw("PATCH", "/listings/926004/binance", {})

    expect(status).toBe(400)
    expect(errorMessage(text)).toContain("nothing to update")
  })

  it("round-trips the alternate symbol", async () => {
    const patched = await runClient((client) =>
      client.Listings.patchListing({
        params: { cmcId: Schema.decodeUnknownSync(CmcId)(926004), exchange: "binance" },
        payload: { alternateSymbol: Schema.decodeUnknownSync(AlternateSymbol)("TSTH4X") }
      })
    )

    expect(patched.alternateSymbol).toBe("TSTH4X")
  })

  it("patches a listing addressed by its snake_case slug", async () => {
    const cmcId = Schema.decodeUnknownSync(CmcId)(926006)
    const cryptoId = await Effect.runPromise(insertCrypto(db, cmcId, "TSTH6"))

    await Effect.runPromise(insertListing(db, cryptoId, "upbitUsdt", true))

    const patched = await runClient((client) =>
      client.Listings.patchListing({ params: { cmcId, exchange: "upbit_usdt" }, payload: { enabled: false } })
    )

    expect(patched.exchange).toBe("upbitUsdt")
    expect(patched.enabled).toBe(false)
  })
})

describe("chain routes", () => {
  it("creates and lists chains", async () => {
    const [created, createdResponse] = await runClient((client) =>
      client.Chains.createChain({
        payload: { code: "TSHTTP", name: "Http Chain" },
        responseMode: "decoded-and-response"
      })
    )

    expect(createdResponse.status).toBe(201)
    expect(created.code).toBe("TSHTTP")

    const body = await runClient((client) => client.Chains.listChains({}))

    expect(body.map((row) => row.code)).toContain("TSHTTP")
  })

  it("rejects a bad chain body", async () => {
    const { status } = await sendRaw("POST", "/chains", { code: "" })

    expect(status).toBe(400)
  })

  it("manages listing chains", async () => {
    const cmcId = Schema.decodeUnknownSync(CmcId)(926005)
    const cryptoId = await Effect.runPromise(insertCrypto(db, cmcId, "TSTH5"))

    await Effect.runPromise(insertListing(db, cryptoId, "bybit", true))

    const [created, createdResponse] = await runClient((client) =>
      client.Chains.upsertListingChain({
        params: { cmcId, exchange: "bybit" },
        payload: {
          chainCode: "TSHTTP",
          exchangeChainCode: "TSHTTP",
          exchangeChainName: "",
          withdrawEnabled: true,
          depositEnabled: true
        },
        responseMode: "decoded-and-response"
      })
    )

    expect(createdResponse.status).toBe(201)
    expect(created.withdrawEnabled).toBe(true)

    const listed = await runClient((client) =>
      client.Chains.listListingChains({ params: { cmcId, exchange: "bybit" } })
    )

    expect(listed.map((row) => row.chainCode)).toContain("TSHTTP")

    const beforeRow = listed.find((row) => row.chainCode === "TSHTTP")

    expect(beforeRow?.withdrawEnabled).toBe(true)
    expect(beforeRow?.depositEnabled).toBe(true)

    const updated = await runClient((client) =>
      client.Chains.updateListingChainFlags({
        params: { cmcId, exchange: "bybit" },
        payload: { chainCode: "TSHTTP", withdrawEnabled: false, depositEnabled: true }
      })
    )

    expect(updated.withdrawEnabled).toBe(false)

    const after = await runClient((client) =>
      client.Chains.listListingChains({ params: { cmcId, exchange: "bybit" } })
    )

    const afterRow = after.find((row) => row.chainCode === "TSHTTP")

    expect(afterRow?.withdrawEnabled).toBe(false)
    expect(afterRow?.depositEnabled).toBe(true)
  })
})

describe("api docs", () => {
  it("serves the interactive reference on /docs", async () => {
    const { status, text } = await getRaw("/docs")

    expect(status).toBe(200)
    expect(text).toContain("api-reference")
  })

  it("serves all twelve operations as OpenAPI 3.1 on /openapi.json", async () => {
    const { status, text } = await getRaw("/openapi.json")

    expect(status).toBe(200)

    const json: unknown = JSON.parse(text)

    const doc = Schema.decodeUnknownSync(Schema.Struct({
      openapi: Schema.String,
      paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
    }))(json)

    expect(doc.openapi).toMatch(/^3\.1/)

    const methods = ["get", "put", "post", "patch", "delete", "options", "head", "trace"]

    const operations = Object.values(doc.paths).flatMap((path) =>
      Object.keys(path).filter((key) => methods.includes(key))
    )

    expect(operations).toHaveLength(12)
  })
})
