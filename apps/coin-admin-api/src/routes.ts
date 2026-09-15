import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi"
import {
  CoinNotFound,
  InvalidCoinError,
  parseChain,
  slugToExchange
} from "@rawr/domain"
import { Api, badRequest, notFound, storeUnavailable } from "./api.js"
import { CoinAdmin } from "./service.js"
import { db } from "./db.js"
import { getExchange, listExchanges } from "./exchange.js"
import { getListing, listListings, setAlternateSymbol, setListingEnabled } from "./listings.js"
import type { ListListingsFilter } from "./listings.js"
import {
  listChains,
  listListingChains,
  updateListingChainFlags,
  upsertChain,
  upsertListingChain
} from "./chains.js"

export type { ApiError } from "./api.js"

// Today's `apiErrorResponse` mapping: validation failures are 400 with their
// message, unknown coins/listings are 404 with their message, and store
// details stay hidden behind 503 "store unavailable". Handlers stay in domain
// errors until the edge, then catchTags narrows each endpoint to exactly the
// declared errors it can produce.
const readErrors = {
  StoreUnavailable: () => Effect.fail(storeUnavailable()),
  InvalidCoinError: (error: InvalidCoinError) => Effect.fail(badRequest(error.message))
} as const

const writeErrors = {
  ...readErrors,
  CoinNotFound: (error: CoinNotFound) => Effect.fail(notFound(error.message))
} as const

const CoinsLive = HttpApiBuilder.group(Api, "Coins", (handlers) =>
  handlers.handleAll({
    listCoins: ({ query }) =>
      Effect.gen(function*() {
        const admin = yield* CoinAdmin

        return yield* admin.listCoins(query.status)
      }).pipe(Effect.catchTags(readErrors)),
    upsertCoin: ({ params, payload }) =>
      Effect.gen(function*() {
        const admin = yield* CoinAdmin

        return yield* admin.upsertCoin({
          cmcId: params.cmcId,
          symbol: payload.symbol,
          name: payload.name,
          slug: payload.slug,
          logo: payload.logo
        })
      }).pipe(Effect.catchTags(readErrors)),
    setCoinStatus: ({ params, payload }) =>
      Effect.gen(function*() {
        const admin = yield* CoinAdmin

        return yield* admin.setStatus(params.cmcId, payload.status, payload.reason)
      }).pipe(Effect.catchTags(writeErrors))
  }))

const ExchangesLive = HttpApiBuilder.group(Api, "Exchanges", (handlers) =>
  handlers.handleAll({
    listExchanges: () => listExchanges(db).pipe(Effect.catchTags(readErrors)),
    getExchange: ({ params }) =>
      Effect.gen(function*() {
        const exchange = yield* slugToExchange(params.exchange)

        return yield* getExchange(db, exchange)
      }).pipe(Effect.catchTags(readErrors))
  }))

const ListingsLive = HttpApiBuilder.group(Api, "Listings", (handlers) =>
  handlers.handleAll({
    listListings: ({ query }) =>
      Effect.gen(function*() {
        const filter: ListListingsFilter = {
          cmcId: query.cmcId,
          enabled: query.enabled === undefined ? undefined : query.enabled === "true"
        }

        const exchange = query.exchange === undefined
          ? undefined
          : yield* slugToExchange(query.exchange)

        return yield* listListings(db, { ...filter, exchange })
      }).pipe(Effect.catchTags(readErrors)),
    patchListing: ({ params, payload }) =>
      Effect.gen(function*() {
        if (payload.enabled === undefined && payload.alternateSymbol === undefined) {
          return yield* Effect.fail(
            new InvalidCoinError({ message: "PATCH /listings: nothing to update" })
          )
        }

        const exchange = yield* slugToExchange(params.exchange)

        if (payload.enabled !== undefined) {
          yield* setListingEnabled(db, params.cmcId, exchange, payload.enabled)
        }

        if (payload.alternateSymbol !== undefined) {
          yield* setAlternateSymbol(db, params.cmcId, exchange, payload.alternateSymbol)
        }

        return yield* getListing(db, params.cmcId, exchange)
      }).pipe(Effect.catchTags(writeErrors))
  }))

const ChainsLive = HttpApiBuilder.group(Api, "Chains", (handlers) =>
  handlers.handleAll({
    listChains: () => listChains(db).pipe(Effect.catchTags(readErrors)),
    createChain: ({ payload }) =>
      Effect.gen(function*() {
        const chain = yield* parseChain({ code: payload.code, name: payload.name })

        return yield* upsertChain(db, chain)
      }).pipe(Effect.catchTags(readErrors)),
    listListingChains: ({ params }) =>
      Effect.gen(function*() {
        const exchange = yield* slugToExchange(params.exchange)

        return yield* listListingChains(db, params.cmcId, exchange)
      }).pipe(Effect.catchTags(writeErrors)),
    upsertListingChain: ({ params, payload }) =>
      Effect.gen(function*() {
        const exchange = yield* slugToExchange(params.exchange)

        return yield* upsertListingChain(db, {
          cmcId: params.cmcId,
          exchange,
          chainCode: payload.chainCode,
          exchangeChainCode: payload.exchangeChainCode,
          exchangeChainName: payload.exchangeChainName,
          withdrawEnabled: payload.withdrawEnabled,
          depositEnabled: payload.depositEnabled
        })
      }).pipe(Effect.catchTags(writeErrors)),
    updateListingChainFlags: ({ params, payload }) =>
      Effect.gen(function*() {
        const exchange = yield* slugToExchange(params.exchange)

        return yield* updateListingChainFlags(db, {
          cmcId: params.cmcId,
          exchange,
          chainCode: payload.chainCode,
          exchangeChainCode: "",
          exchangeChainName: "",
          withdrawEnabled: payload.withdrawEnabled,
          depositEnabled: payload.depositEnabled
        })
      }).pipe(Effect.catchTags(writeErrors))
  }))

export const ApiGroupsLive = Layer.mergeAll(CoinsLive, ExchangesLive, ListingsLive, ChainsLive)

// HttpApi routes + Scalar docs + OpenAPI JSON in one router layer. The docs
// and JSON routes live outside the Api groups, so they stay out of the
// generated document itself.
export const ApiRouterLive = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(ApiGroupsLive),
  Layer.provide(HttpApiScalar.layer(Api))
)

// Back-compat alias: the previous hand-wired `HttpRouter` route list.
// Prefer `ApiRouterLive` (or `Api` + `ApiGroupsLive`) for new wiring.
export const RoutesLive = ApiRouterLive
