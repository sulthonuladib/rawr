import { Effect, Match, Schema } from "effect"
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import {
  AlternateSymbol,
  Chain,
  CmcId,
  CoinNotFound,
  InvalidCoinError,
  ListingChain,
  parseChain,
  slugToExchange,
  StoreUnavailable,
  Symbol
} from "@rawr/domain"
import { Cryptocurrency } from "./cryptocurrency.js"
import { CoinAdmin } from "./service.js"
import { db } from "./db.js"
import { ExchangeInfo, getExchange, listExchanges } from "./exchange.js"
import { getListing, Listing, listListings, setAlternateSymbol, setListingEnabled } from "./listings.js"
import type { ListListingsFilter } from "./listings.js"
import {
  getTransferSpeed,
  listChains,
  listListingChains,
  updateListingChainFlags,
  upsertChain,
  upsertListingChain
} from "./chains.js"
import type { Exchange } from "@rawr/domain"

export type ApiError = CoinNotFound | StoreUnavailable | InvalidCoinError

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const CmcIdFromString = Schema.decodeTo(CmcId)(Schema.NumberFromString)

const CmcIdPath = Schema.Struct({ cmcId: CmcIdFromString })

const CoinStatusBody = Schema.Struct({
  status: Schema.Literals(["active", "inactive"]),
  reason: Schema.String
})

const UpsertCoinBody = Schema.Struct({
  symbol: Symbol,
  name: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  logo: Schema.String
})

const ListCoinsQuery = Schema.Struct({
  status: Schema.optional(Schema.Literals(["active", "inactive"]))
})

const ListingPath = Schema.Struct({ cmcId: CmcIdFromString, exchange: Schema.String })

const ListingPatchBody = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  alternateSymbol: Schema.optional(AlternateSymbol)
})

const ListListingsQuery = Schema.Struct({
  cmcId: Schema.optional(CmcIdFromString),
  exchange: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Literals(["true", "false"]))
})

const ChainBody = Schema.Struct({ code: Schema.NonEmptyString, name: Schema.NonEmptyString })

const ListingChainPath = Schema.Struct({
  cmcId: CmcIdFromString,
  exchange: Schema.String
})

const UpsertListingChainBody = Schema.Struct({
  chainCode: Schema.NonEmptyString,
  exchangeChainCode: Schema.NonEmptyString,
  exchangeChainName: Schema.String,
  withdrawEnabled: Schema.Boolean,
  depositEnabled: Schema.Boolean
})

const UpdateListingChainBody = Schema.Struct({
  chainCode: Schema.NonEmptyString,
  withdrawEnabled: Schema.Boolean,
  depositEnabled: Schema.Boolean
})

const mapDecodeError = (operation: string) => <A, E, R>(
  self: Effect.Effect<A, E, R>
): Effect.Effect<A, InvalidCoinError, R> =>
  Effect.mapError(self, (cause) => new InvalidCoinError({ message: `${operation}: ${describeCause(cause)}` }))

const errorJson = (status: 400 | 404 | 503, message: string) =>
  HttpServerResponse.json({ error: message }, { status })

const apiErrorResponse = Match.type<ApiError | HttpBody.HttpBodyError>().pipe(
  Match.tag("InvalidCoinError", (error) => errorJson(400, error.message)),
  Match.tag("CoinNotFound", (error) => errorJson(404, error.message)),
  Match.tag("StoreUnavailable", () => errorJson(503, "store unavailable")),
  Match.tag("HttpBodyError", (error) => Effect.fail(error)),
  Match.exhaustive
)

const catchApiErrors = <E extends ApiError | HttpBody.HttpBodyError, R>(
  self: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
) => Effect.matchEffect(self, { onFailure: apiErrorResponse, onSuccess: Effect.succeed })

const respondCoin = HttpServerResponse.schemaJson(Cryptocurrency)

const respondCoins = HttpServerResponse.schemaJson(Schema.Array(Cryptocurrency))

const respondExchanges = HttpServerResponse.schemaJson(Schema.Array(ExchangeInfo))

const respondListings = HttpServerResponse.schemaJson(Schema.Array(Listing))

const respondChains = HttpServerResponse.schemaJson(Schema.Array(Chain))

const respondListingChains = HttpServerResponse.schemaJson(Schema.Array(ListingChain))

const resolveExchange = (slug: string): Effect.Effect<Exchange, InvalidCoinError> => slugToExchange(slug)

const listCoinsRoute = HttpRouter.route(
  "GET",
  "/coins",
  Effect.gen(function*() {
    const query = yield* HttpRouter.schemaParams(ListCoinsQuery).pipe(mapDecodeError("GET /coins query"))
    const admin = yield* CoinAdmin
    const coins = yield* admin.listCoins(query.status)

    return yield* respondCoins(coins)
  }).pipe(catchApiErrors)
)

const upsertCoinRoute = HttpRouter.route(
  "PUT",
  "/coins/:cmcId",
  Effect.gen(function*() {
    const path = yield* HttpRouter.schemaPathParams(CmcIdPath).pipe(mapDecodeError("PUT /coins path"))

    const body = yield* HttpServerRequest.schemaBodyJson(UpsertCoinBody).pipe(
      mapDecodeError("PUT /coins body")
    )

    const admin = yield* CoinAdmin

    const coin = yield* admin.upsertCoin({
      cmcId: path.cmcId,
      symbol: body.symbol,
      name: body.name,
      slug: body.slug,
      logo: body.logo
    })

    return yield* respondCoin(coin)
  }).pipe(catchApiErrors)
)

const setCoinStatusRoute = HttpRouter.route(
  "PATCH",
  "/coins/:cmcId/status",
  Effect.gen(function*() {
    const path = yield* HttpRouter.schemaPathParams(CmcIdPath).pipe(mapDecodeError("PATCH /coins path"))

    const body = yield* HttpServerRequest.schemaBodyJson(CoinStatusBody).pipe(
      mapDecodeError("PATCH /coins body")
    )

    const admin = yield* CoinAdmin
    const coin = yield* admin.setStatus(path.cmcId, body.status, body.reason)

    return yield* respondCoin(coin)
  }).pipe(catchApiErrors)
)

const listExchangesRoute = HttpRouter.route(
  "GET",
  "/exchanges",
  Effect.gen(function*() {
    const rows = yield* listExchanges(db)

    return yield* respondExchanges(rows)
  }).pipe(catchApiErrors)
)

const getExchangeRoute = HttpRouter.route(
  "GET",
  "/exchanges/:exchange",
  Effect.gen(function*() {
    const path = yield* HttpRouter.schemaPathParams(Schema.Struct({ exchange: Schema.String })).pipe(
      mapDecodeError("GET /exchanges path")
    )

    const exchange = yield* resolveExchange(path.exchange)
    const row = yield* getExchange(db, exchange)

    return yield* HttpServerResponse.schemaJson(ExchangeInfo)(row)
  }).pipe(catchApiErrors)
)

const listListingsRoute = HttpRouter.route(
  "GET",
  "/listings",
  Effect.gen(function*() {
    const query = yield* HttpRouter.schemaParams(ListListingsQuery).pipe(mapDecodeError("GET /listings query"))

    const filter: ListListingsFilter = {
      cmcId: query.cmcId,
      enabled: query.enabled === undefined ? undefined : query.enabled === "true"
    }

    const exchange = query.exchange === undefined
      ? undefined
      : yield* resolveExchange(query.exchange)

    const rows = yield* listListings(db, { ...filter, exchange })

    return yield* respondListings(rows)
  }).pipe(catchApiErrors)
)

const patchListingRoute = HttpRouter.route(
  "PATCH",
  "/listings/:cmcId/:exchange",
  Effect.gen(function*() {
    const path = yield* HttpRouter.schemaPathParams(ListingPath).pipe(mapDecodeError("PATCH /listings path"))

    const body = yield* HttpServerRequest.schemaBodyJson(ListingPatchBody).pipe(
      mapDecodeError("PATCH /listings body")
    )

    if (body.enabled === undefined && body.alternateSymbol === undefined) {
      return yield* Effect.fail(
        new InvalidCoinError({ message: "PATCH /listings: nothing to update" })
      )
    }

    const exchange = yield* resolveExchange(path.exchange)

    if (body.enabled !== undefined) {
      yield* setListingEnabled(db, path.cmcId, exchange, body.enabled)
    }

    if (body.alternateSymbol !== undefined) {
      yield* setAlternateSymbol(db, path.cmcId, exchange, body.alternateSymbol)
    }

    const listing = yield* getListing(db, path.cmcId, exchange)

    return yield* HttpServerResponse.schemaJson(Listing)(listing)
  }).pipe(catchApiErrors)
)

const listChainsRoute = HttpRouter.route(
  "GET",
  "/chains",
  Effect.gen(function*() {
    const rows = yield* listChains(db)

    return yield* respondChains(rows)
  }).pipe(catchApiErrors)
)

const postChainRoute = HttpRouter.route(
  "POST",
  "/chains",
  Effect.gen(function*() {
    const body = yield* HttpServerRequest.schemaBodyJson(ChainBody).pipe(mapDecodeError("POST /chains body"))
    const chain = yield* parseChain({ code: body.code, name: body.name })
    const persisted = yield* upsertChain(db, chain)

    return yield* HttpServerResponse.schemaJson(Chain)(persisted, { status: 201 })
  }).pipe(catchApiErrors)
)

const listListingChainsRoute = HttpRouter.route(
  "GET",
  "/listings/:cmcId/:exchange/chains",
  Effect.gen(function*() {
    const path = yield* HttpRouter.schemaPathParams(ListingChainPath).pipe(
      mapDecodeError("GET /listings chains path")
    )

    const exchange = yield* resolveExchange(path.exchange)
    const rows = yield* listListingChains(db, path.cmcId, exchange)

    return yield* respondListingChains(rows)
  }).pipe(catchApiErrors)
)

const postListingChainRoute = HttpRouter.route(
  "POST",
  "/listings/:cmcId/:exchange/chains",
  Effect.gen(function*() {
    const path = yield* HttpRouter.schemaPathParams(ListingChainPath).pipe(
      mapDecodeError("POST /listings chains path")
    )

    const body = yield* HttpServerRequest.schemaBodyJson(UpsertListingChainBody).pipe(
      mapDecodeError("POST /listings chains body")
    )

    const exchange = yield* resolveExchange(path.exchange)

    const persisted = yield* upsertListingChain(db, {
      cmcId: path.cmcId,
      exchange,
      chainCode: body.chainCode,
      exchangeChainCode: body.exchangeChainCode,
      exchangeChainName: body.exchangeChainName,
      withdrawEnabled: body.withdrawEnabled,
      depositEnabled: body.depositEnabled
    })

    return yield* HttpServerResponse.schemaJson(ListingChain)(persisted, { status: 201 })
  }).pipe(catchApiErrors)
)

const patchListingChainRoute = HttpRouter.route(
  "PATCH",
  "/listings/:cmcId/:exchange/chains",
  Effect.gen(function*() {
    const path = yield* HttpRouter.schemaPathParams(ListingChainPath).pipe(
      mapDecodeError("PATCH /listings chains path")
    )

    const body = yield* HttpServerRequest.schemaBodyJson(UpdateListingChainBody).pipe(
      mapDecodeError("PATCH /listings chains body")
    )

    const exchange = yield* resolveExchange(path.exchange)

    const persisted = yield* updateListingChainFlags(db, {
      cmcId: path.cmcId,
      exchange,
      chainCode: body.chainCode,
      exchangeChainCode: "",
      exchangeChainName: "",
      withdrawEnabled: body.withdrawEnabled,
      depositEnabled: body.depositEnabled
    })

    return yield* HttpServerResponse.schemaJson(ListingChain)(persisted)
  }).pipe(catchApiErrors)
)

const getTransferSpeedRoute = HttpRouter.route(
  "GET",
  "/listings/:cmcId/:exchange/speed",
  Effect.gen(function*() {
    const path = yield* HttpRouter.schemaPathParams(ListingChainPath).pipe(
      mapDecodeError("GET /listings speed path")
    )

    const exchange = yield* resolveExchange(path.exchange)
    const speed = yield* getTransferSpeed(db, path.cmcId, exchange)

    return yield* HttpServerResponse.json({ cmcId: path.cmcId, exchange, transferSpeed: speed })
  }).pipe(catchApiErrors)
)

export const RoutesLive = HttpRouter.addAll([
  listCoinsRoute,
  upsertCoinRoute,
  setCoinStatusRoute,
  listExchangesRoute,
  getExchangeRoute,
  listListingsRoute,
  patchListingRoute,
  listChainsRoute,
  postChainRoute,
  listListingChainsRoute,
  postListingChainRoute,
  patchListingChainRoute,
  getTransferSpeedRoute
])
