import { Effect, Schema } from "effect"
import { AlternateSymbol, Chain, CmcId, Exchange, ListingChain, TransferSpeed } from "@rawr/domain"
import { exchangeToSlug } from "@rawr/domain"
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

export { AlternateSymbol, Chain, CmcId, Exchange, ListingChain, Symbol, TransferSpeed } from "@rawr/domain"

export class ClientError extends Schema.TaggedError<ClientError>()("ClientError", {
  message: Schema.String,
  status: Schema.optional(Schema.Int)
}) {}

const ErrorBody = Schema.Struct({ error: Schema.String })

const SpeedBody = Schema.Struct({
  cmcId: CmcId,
  exchange: Exchange,
  transferSpeed: TransferSpeed
})

export type SpeedBody = typeof SpeedBody.Type

const CoinsBody = Schema.Array(Cryptocurrency)

const ExchangesBody = Schema.Array(ExchangeInfo)

const ListingsBody = Schema.Array(Listing)

const ChainsBody = Schema.Array(Chain)

const ListingChainsBody = Schema.Array(ListingChain)

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
  readonly getTransferSpeed: (cmcId: CmcId, exchange: Exchange) => Effect.Effect<SpeedBody, ClientError>
}

const toClientError = (message: string, status?: number | undefined): ClientError =>
  status === undefined ? new ClientError({ message }) : new ClientError({ message, status })

export const makeCoinAdminClient = (options: CoinAdminClientOptions): CoinAdminClient => {
  const fetchFn = options.fetchFn ?? fetch
  const baseUrl = options.baseUrl.replace(/\/$/, "")

  const readErrorBody = (response: Response): Effect.Effect<string, ClientError> =>
    Effect.gen(function*() {
      const json: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          toClientError(`request failed with status ${response.status}: ${describeCause(cause)}`, response.status)
      })

      const decoded = yield* Schema.decodeUnknownEffect(ErrorBody)(json).pipe(
        Effect.mapError(() => toClientError(`request failed with status ${response.status}`, response.status))
      )

      return decoded.error
    })

  const requestJson = <S extends Schema.Constraint & { readonly DecodingServices: never }>(
    path: string,
    init: RequestInit,
    schema: S
  ): Effect.Effect<S["Type"], ClientError> =>
    Effect.gen(function*() {
      const response = yield* Effect.tryPromise({
        try: () => fetchFn(`${baseUrl}${path}`, init),
        catch: (cause) => toClientError(`request failed: ${describeCause(cause)}`)
      })

      if (!response.ok) {
        const message = yield* readErrorBody(response)

        return yield* Effect.fail(toClientError(message, response.status))
      }

      const json: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) => toClientError(`unreadable response body: ${describeCause(cause)}`, response.status)
      })

      return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError((cause) => toClientError(`undecodable response body: ${describeCause(cause)}`, response.status))
      )
    })

  const jsonInit = (method: string, body: string): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body
  })

  const listingPath = (cmcId: CmcId, exchange: Exchange): string =>
    `/listings/${cmcId}/${exchangeToSlug(exchange)}`

  const toQuery = (query: ListListingsQuery): string => {
    const params = new URLSearchParams()

    if (query.cmcId !== undefined) {
      params.set("cmcId", String(query.cmcId))
    }

    if (query.exchange !== undefined) {
      params.set("exchange", exchangeToSlug(query.exchange))
    }

    if (query.enabled !== undefined) {
      params.set("enabled", String(query.enabled))
    }

    const text = params.toString()

    return text === "" ? "" : `?${text}`
  }

  return {
    listCoins: (status) =>
      requestJson(status === undefined ? "/coins" : `/coins?status=${status}`, {}, CoinsBody),
    upsertCoin: (input) =>
      requestJson(`/coins/${input.cmcId}`, jsonInit("PUT", JSON.stringify({
        symbol: input.symbol,
        name: input.name,
        slug: input.slug,
        logo: input.logo
      })), Cryptocurrency),
    setCoinStatus: (cmcId, status, reason) =>
      requestJson(`/coins/${cmcId}/status`, jsonInit("PATCH", JSON.stringify({ status, reason })), Cryptocurrency),
    listExchanges: () => requestJson("/exchanges", {}, ExchangesBody),
    getExchange: (exchange) => requestJson(`/exchanges/${exchangeToSlug(exchange)}`, {}, ExchangeInfo),
    listListings: (query) =>
      requestJson(query === undefined ? "/listings" : `/listings${toQuery(query)}`, {}, ListingsBody),
    patchListing: (cmcId, exchange, input) =>
      requestJson(listingPath(cmcId, exchange), jsonInit("PATCH", JSON.stringify(input)), Listing),
    listChains: () => requestJson("/chains", {}, ChainsBody),
    createChain: (code, name) =>
      requestJson("/chains", jsonInit("POST", JSON.stringify({ code, name })), Chain),
    listListingChains: (cmcId, exchange) =>
      requestJson(`${listingPath(cmcId, exchange)}/chains`, {}, ListingChainsBody),
    upsertListingChain: (input) =>
      requestJson(`${listingPath(input.cmcId, input.exchange)}/chains`, jsonInit("POST", JSON.stringify({
        chainCode: input.chainCode,
        exchangeChainCode: input.exchangeChainCode,
        exchangeChainName: input.exchangeChainName,
        withdrawEnabled: input.withdrawEnabled,
        depositEnabled: input.depositEnabled
      })), ListingChain),
    updateListingChainFlags: (input) =>
      requestJson(`${listingPath(input.cmcId, input.exchange)}/chains`, jsonInit("PATCH", JSON.stringify({
        chainCode: input.chainCode,
        withdrawEnabled: input.withdrawEnabled,
        depositEnabled: input.depositEnabled
      })), ListingChain),
    getTransferSpeed: (cmcId, exchange) =>
      requestJson(`${listingPath(cmcId, exchange)}/speed`, {}, SpeedBody)
  }
}
