import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import { HttpBody, HttpClient, HttpClientResponse, HttpRouter } from "effect/unstable/http"
import { afterAll, describe, expect, it } from "vitest"
import { CmcId, Exchange, TransferSpeed } from "@rawr/domain"
import { Cryptocurrency } from "./cryptocurrency.js"
import { db, pool } from "./db.js"
import { ExchangeInfo } from "./exchange.js"
import { insertCrypto, insertListing } from "./fixtures.js"
import { Listing } from "./listings.js"
import { Chain, ListingChain } from "@rawr/domain"
import { RoutesLive } from "./routes.js"
import { CoinAdmin } from "./service.js"

const CoinsBody = Schema.Array(Cryptocurrency)

const ExchangesBody = Schema.Array(ExchangeInfo)

const ListingsBody = Schema.Array(Listing)

const ChainsBody = Schema.Array(Chain)

const ListingChainsBody = Schema.Array(ListingChain)

const ErrorBody = Schema.Struct({ error: Schema.String })

const SpeedBody = Schema.Struct({ cmcId: CmcId, exchange: Exchange, transferSpeed: TransferSpeed })

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

const getJson = <S extends Schema.Constraint & { readonly DecodingServices: never }>(
  path: string,
  schema: S
): Promise<{ readonly status: number; readonly body: S["Type"] }> =>
  runApi(
    Effect.gen(function*() {
      const response = yield* HttpClient.get(path)
      const body = yield* HttpClientResponse.schemaBodyJson(schema)(response)

      return { status: response.status, body }
    })
  )

const sendJson = <S extends Schema.Constraint & { readonly DecodingServices: never }>(
  method: "POST" | "PUT" | "PATCH",
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- test helper forwards arbitrary JSON fixtures; routes decode below.
  payload: unknown,
  schema: S
): Promise<{ readonly status: number; readonly body: S["Type"] }> =>
  runApi(
    Effect.gen(function*() {
      const response = yield* senders[method](path, { body: HttpBody.jsonUnsafe(payload) })
      const body = yield* HttpClientResponse.schemaBodyJson(schema)(response)

      return { status: response.status, body }
    })
  )

afterAll(async () => {
  await pool.end()
})

describe("coin routes", () => {
  it("lists active coins", async () => {
    await Effect.runPromise(insertCrypto(db, Schema.decodeUnknownSync(CmcId)(926001), "TSTH"))

    const { status, body } = await getJson("/coins?status=active", CoinsBody)

    expect(status).toBe(200)
    expect(body.map((coin) => coin.cmcId)).toContain(926001)
  })

  it("rejects an unknown status filter", async () => {
    const { status, body } = await getJson("/coins?status=bogus", ErrorBody)

    expect(status).toBe(400)
    expect(body.error).toContain("GET /coins query")
  })

  it("upserts a coin over PUT", async () => {
    const first = await sendJson("PUT", "/coins/926002", {
      symbol: "TSTH2",
      name: "Http Two",
      slug: "http-two",
      logo: ""
    }, Cryptocurrency)

    expect(first.status).toBe(200)
    expect(first.body.symbol).toBe("TSTH2")

    const second = await sendJson("PUT", "/coins/926002", {
      symbol: "TSTH2",
      name: "Http Two v2",
      slug: "http-two",
      logo: ""
    }, Cryptocurrency)

    expect(second.status).toBe(200)
    expect(second.body.name).toBe("Http Two v2")
  })

  it("rejects a non-numeric cmcId", async () => {
    const { status } = await sendJson("PUT", "/coins/abc", {
      symbol: "X",
      name: "X",
      slug: "x",
      logo: ""
    }, ErrorBody)

    expect(status).toBe(400)
  })

  it("changes status over PATCH", async () => {
    await sendJson("PUT", "/coins/926003", {
      symbol: "TSTH3",
      name: "Http Three",
      slug: "http-three",
      logo: ""
    }, Cryptocurrency)

    const patched = await sendJson("PATCH", "/coins/926003/status", {
      status: "inactive",
      reason: "route test"
    }, Cryptocurrency)

    expect(patched.status).toBe(200)
    expect(patched.body.status).toBe("inactive")
    expect(patched.body.reason).toBe("route test")
  })

  it("rejects a malformed status body", async () => {
    const { status, body } = await sendJson("PATCH", "/coins/926003/status", {
      status: "archived"
    }, ErrorBody)

    expect(status).toBe(400)
    expect(body.error).toContain("PATCH /coins body")
  })

  it("returns 404 for a missing coin status change", async () => {
    const { status, body } = await sendJson("PATCH", "/coins/969999/status", {
      status: "inactive",
      reason: "nope"
    }, ErrorBody)

    expect(status).toBe(404)
    expect(body.error).toContain("969999")
  })
})

describe("registry reads", () => {
  it("lists exchanges", async () => {
    const { status, body } = await getJson("/exchanges", ExchangesBody)

    expect(status).toBe(200)
    expect(body).toHaveLength(15)
    expect(body.map((row) => row.slug)).toContain("binance")
  })

  it("reads one exchange", async () => {
    const { status, body } = await getJson("/exchanges/upbit_usdt", ExchangeInfo)

    expect(status).toBe(200)
    expect(body.slug).toBe("upbit_usdt")
  })

  it("rejects an unknown exchange slug", async () => {
    const { status } = await getJson("/exchanges/nope", ErrorBody)

    expect(status).toBe(400)
  })
})

describe("listing routes", () => {
  it("disables a listing over PATCH", async () => {
    const cmcId = Schema.decodeUnknownSync(CmcId)(926004)
    const cryptoId = await Effect.runPromise(insertCrypto(db, cmcId, "TSTH4"))

    await Effect.runPromise(insertListing(db, cryptoId, "binance", true))

    // Reset: insertListing is insert-only, so re-enable explicitly to keep
    // this test idempotent across runs against the shared Postgres.
    await sendJson("PATCH", "/listings/926004/binance", { enabled: true }, Listing)

    const before = await getJson("/listings?cmcId=926004", ListingsBody)

    expect(before.status).toBe(200)
    expect(before.body.map((row) => row.enabled)).toContain(true)

    const patched = await sendJson("PATCH", "/listings/926004/binance", { enabled: false }, Listing)

    expect(patched.status).toBe(200)
    expect(patched.body.enabled).toBe(false)

    const after = await getJson("/listings?cmcId=926004&enabled=false", ListingsBody)

    expect(after.status).toBe(200)
    expect(after.body.map((row) => row.exchange)).toContain("binance")
  })

  it("rejects an empty listing patch", async () => {
    const { status } = await sendJson("PATCH", "/listings/926004/binance", {}, ErrorBody)

    expect(status).toBe(400)
  })

  it("round-trips the alternate symbol", async () => {
    const patched = await sendJson("PATCH", "/listings/926004/binance", {
      alternateSymbol: "TSTH4X"
    }, Listing)

    expect(patched.status).toBe(200)
    expect(patched.body.alternateSymbol).toBe("TSTH4X")
  })
})

describe("chain routes", () => {
  it("creates and lists chains", async () => {
    const created = await sendJson("POST", "/chains", { code: "TSHTTP", name: "Http Chain" }, Chain)

    expect(created.status).toBe(201)
    expect(created.body.code).toBe("TSHTTP")

    const { status, body } = await getJson("/chains", ChainsBody)

    expect(status).toBe(200)
    expect(body.map((row) => row.code)).toContain("TSHTTP")
  })

  it("rejects a bad chain body", async () => {
    const { status } = await sendJson("POST", "/chains", { code: "" }, ErrorBody)

    expect(status).toBe(400)
  })

  it("manages listing chains", async () => {
    const cmcId = Schema.decodeUnknownSync(CmcId)(926005)
    const cryptoId = await Effect.runPromise(insertCrypto(db, cmcId, "TSTH5"))

    await Effect.runPromise(insertListing(db, cryptoId, "bybit", true))

    const created = await sendJson("POST", "/listings/926005/bybit/chains", {
      chainCode: "TSHTTP",
      exchangeChainCode: "TSHTTP",
      exchangeChainName: "",
      withdrawEnabled: true,
      depositEnabled: true
    }, ListingChain)

    expect(created.status).toBe(201)
    expect(created.body.withdrawEnabled).toBe(true)

    const listed = await getJson("/listings/926005/bybit/chains", ListingChainsBody)

    expect(listed.status).toBe(200)
    expect(listed.body.map((row) => row.chainCode)).toContain("TSHTTP")

    const speedBefore = await getJson("/listings/926005/bybit/speed", SpeedBody)

    expect(speedBefore.body.transferSpeed).toBe("available")

    const updated = await sendJson("PATCH", "/listings/926005/bybit/chains", {
      chainCode: "TSHTTP",
      withdrawEnabled: false,
      depositEnabled: true
    }, ListingChain)

    expect(updated.status).toBe(200)
    expect(updated.body.withdrawEnabled).toBe(false)

    const speedAfter = await getJson("/listings/926005/bybit/speed", SpeedBody)

    expect(speedAfter.body.transferSpeed).toBe("unavailable")
  })
})
