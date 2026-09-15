import { Effect, Match, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"
import { AlternateSymbol, Chain, CmcId, Exchange, ListingChain } from "@rawr/domain"
import { exchangeToSlug } from "@rawr/domain"
import { Api } from "./api.js"
import type { BadRequest, NotFound, Unavailable } from "./api.js"
import { Cryptocurrency } from "./cryptocurrency.js"
import type { CoinStatusValue, UpsertCoinInput } from "./cryptocurrency.js"
import { ExchangeInfo } from "./exchange.js"
import { Listing } from "./listings.js"
import type { ListingChainInput } from "./chains.js"

// Re-exported so consumers program against one module. The underlying
// Schemas live with their repos or domain; the client only encodes requests
// and decodes responses at the HTTP edge.
export { Cryptocurrency } from "./cryptocurrency.js"

export type { CoinStatusValue, UpsertCoinInput } from "./cryptocurrency.js"

export { ExchangeInfo } from "./exchange.js"

export { Listing } from "./listings.js"

export { AlternateSymbol, Chain, CmcId, Exchange, ListingChain, Symbol } from "@rawr/domain"

export class ClientError extends Schema.TaggedError<ClientError>()("ClientError", {
  message: Schema.String,
  status: Schema.optional(Schema.Int)
}) {}

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export interface CoinAdminClientOptions {
  readonly baseUrl: string
  readonly fetchFn?: typeof fetch | undefined
}

export interface ListListingsQuery {
  readonly cmcId?: CmcId | undefined
  readonly exchange?: Exchange | undefined
  readonly enabled?: boolean | undefined
}

export interface PatchListingInput {
  readonly enabled?: boolean | undefined
  readonly alternateSymbol?: AlternateSymbol | undefined
}

interface MutableListingsApiQuery {
  cmcId?: CmcId
  exchange?: string
  enabled?: "true" | "false"
}

interface ListingsApiQuery {
  readonly cmcId?: CmcId
  readonly exchange?: string
  readonly enabled?: "true" | "false"
}

export interface CoinAdminClient {
  readonly listCoins: (
    status?: CoinStatusValue | undefined
  ) => Effect.Effect<ReadonlyArray<Cryptocurrency>, ClientError>
  readonly upsertCoin: (
    input: UpsertCoinInput
  ) => Effect.Effect<Cryptocurrency, ClientError>
  readonly setCoinStatus: (
    cmcId: CmcId,
    status: CoinStatusValue,
    reason: string
  ) => Effect.Effect<Cryptocurrency, ClientError>
  readonly listExchanges: () => Effect.Effect<ReadonlyArray<ExchangeInfo>, ClientError>
  readonly getExchange: (exchange: Exchange) => Effect.Effect<ExchangeInfo, ClientError>
  readonly listListings: (
    query?: ListListingsQuery | undefined
  ) => Effect.Effect<ReadonlyArray<Listing>, ClientError>
  readonly patchListing: (
    cmcId: CmcId,
    exchange: Exchange,
    input: PatchListingInput
  ) => Effect.Effect<Listing, ClientError>
  readonly listChains: () => Effect.Effect<ReadonlyArray<Chain>, ClientError>
  readonly createChain: (code: string, name: string) => Effect.Effect<Chain, ClientError>
  readonly listListingChains: (
    cmcId: CmcId,
    exchange: Exchange
  ) => Effect.Effect<ReadonlyArray<ListingChain>, ClientError>
  readonly upsertListingChain: (
    input: ListingChainInput
  ) => Effect.Effect<ListingChain, ClientError>
  readonly updateListingChainFlags: (
    input: ListingChainInput
  ) => Effect.Effect<ListingChain, ClientError>
}

type ClientFailure =
  | BadRequest
  | NotFound
  | Unavailable
  | HttpClientError.HttpClientError
  | Schema.SchemaError

// Failures the derived client cannot decode into the Api envelope (transport
// breakdowns, undeclared statuses, undecodable bodies) still surface as
// ClientError, keeping the status when the transport reports one.
const statusFailure = (status: number): ClientError =>
  new ClientError({ message: `request failed with status ${status}`, status })

const fallbackError = (cause: unknown): ClientError => {
  if (HttpClientError.isHttpClientError(cause)) {
    return Match.value(cause.reason).pipe(
      Match.tag("TransportError", (reason) =>
        new ClientError({ message: `request failed: ${describeCause(reason.cause)}` })),
      Match.tags({
        StatusCodeError: (reason: HttpClientError.StatusCodeError) =>
          statusFailure(reason.response.status),
        DecodeError: (reason: HttpClientError.DecodeError) => statusFailure(reason.response.status)
      }),
      Match.orElse((reason) => new ClientError({ message: describeCause(reason) }))
    )
  }

  return new ClientError({ message: describeCause(cause) })
}

export const makeCoinAdminClient = (options: CoinAdminClientOptions): CoinAdminClient => {
  const baseUrl = options.baseUrl.replace(/\/$/, "")

  const apiClient = HttpApiClient.make(Api, { baseUrl })

  const provideFetch = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    options.fetchFn === undefined
      ? self
      : Effect.provideService(self, FetchHttpClient.Fetch, options.fetchFn)

  const serve = <A>(
    self: Effect.Effect<A, ClientFailure, HttpClient.HttpClient>
  ): Effect.Effect<A, ClientError> =>
    self.pipe(
      Effect.catchTags(
        {
          BadRequest: (error: BadRequest) =>
            Effect.fail(new ClientError({ message: error.error, status: 400 })),
          NotFound: (error: NotFound) =>
            Effect.fail(new ClientError({ message: error.error, status: 404 })),
          Unavailable: (error: Unavailable) =>
            Effect.fail(new ClientError({ message: error.error, status: 503 }))
        },
        (remaining) => Effect.fail(fallbackError(remaining))
      ),
      Effect.provide(FetchHttpClient.layer),
      provideFetch
    )

  const listingParams = (cmcId: CmcId, exchange: Exchange) => ({
    cmcId,
    exchange: exchangeToSlug(exchange)
  })

  const toListingsQuery = (query: ListListingsQuery): ListingsApiQuery => {
    const result: MutableListingsApiQuery = {}

    if (query.cmcId !== undefined) {
      result.cmcId = query.cmcId
    }

    if (query.exchange !== undefined) {
      result.exchange = exchangeToSlug(query.exchange)
    }

    if (query.enabled !== undefined) {
      result.enabled = query.enabled ? "true" : "false"
    }

    return result
  }

  return {
    listCoins: (status) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Coins.listCoins({ query: status === undefined ? {} : { status } }))
      ),
    upsertCoin: (input) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Coins.upsertCoin({
            params: { cmcId: input.cmcId },
            payload: { symbol: input.symbol, name: input.name, slug: input.slug, logo: input.logo }
          }))
      ),
    setCoinStatus: (cmcId, status, reason) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Coins.setCoinStatus({ params: { cmcId }, payload: { status, reason } }))
      ),
    listExchanges: () => serve(Effect.flatMap(apiClient, (client) => client.Exchanges.listExchanges({}))),
    getExchange: (exchange) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Exchanges.getExchange({ params: { exchange: exchangeToSlug(exchange) } }))
      ),
    listListings: (query) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Listings.listListings({ query: toListingsQuery(query ?? {}) }))
      ),
    patchListing: (cmcId, exchange, input) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Listings.patchListing({
            params: listingParams(cmcId, exchange),
            payload: { enabled: input.enabled, alternateSymbol: input.alternateSymbol }
          }))
      ),
    listChains: () => serve(Effect.flatMap(apiClient, (client) => client.Chains.listChains({}))),
    createChain: (code, name) =>
      serve(
        Effect.flatMap(apiClient, (client) => client.Chains.createChain({ payload: { code, name } }))
      ),
    listListingChains: (cmcId, exchange) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Chains.listListingChains({ params: listingParams(cmcId, exchange) }))
      ),
    upsertListingChain: (input) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Chains.upsertListingChain({
            params: listingParams(input.cmcId, input.exchange),
            payload: {
              chainCode: input.chainCode,
              exchangeChainCode: input.exchangeChainCode,
              exchangeChainName: input.exchangeChainName,
              withdrawEnabled: input.withdrawEnabled,
              depositEnabled: input.depositEnabled
            }
          }))
      ),
    updateListingChainFlags: (input) =>
      serve(
        Effect.flatMap(apiClient, (client) =>
          client.Chains.updateListingChainFlags({
            params: listingParams(input.cmcId, input.exchange),
            payload: {
              chainCode: input.chainCode,
              withdrawEnabled: input.withdrawEnabled,
              depositEnabled: input.depositEnabled
            }
          }))
      )
  }
}
