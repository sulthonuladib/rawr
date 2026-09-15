import { Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { AlternateSymbol, Chain, CmcId, ListingChain, Symbol } from "@rawr/domain"
import { Cryptocurrency } from "./cryptocurrency.js"
import { ExchangeInfo } from "./exchange.js"
import { Listing } from "./listings.js"

// Error envelope: the wire shape stays byte-compatible with the hand-wired
// router (`{ "error": <string> }` with 400/404/503 statuses). The decoded
// (domain) side is tagged so the server union-encode selects the status from
// the value and the derived client recovers message + status. Stripping the
// tag on the wire (instead of leaking `_tag`) keeps old consumers and the
// existing `{ error }` contract tests working unchanged.
const ErrorWire = Schema.Struct({ error: Schema.String })

const BadRequestDomain = Schema.TaggedStruct("BadRequest", { error: Schema.String })

export type BadRequest = typeof BadRequestDomain["Type"]

export const badRequest = (message: string): BadRequest => BadRequestDomain.make({ error: message })

export const BadRequestError = BadRequestDomain.pipe(
  Schema.encodeTo(ErrorWire, {
    decode: SchemaGetter.transform((wire: { readonly error: string }) => badRequest(wire.error)),
    encode: SchemaGetter.transform((domain: BadRequest) => ({ error: domain.error }))
  }),
  HttpApiSchema.status(400)
)

const NotFoundDomain = Schema.TaggedStruct("NotFound", { error: Schema.String })

export type NotFound = typeof NotFoundDomain["Type"]

export const notFound = (message: string): NotFound => NotFoundDomain.make({ error: message })

export const NotFoundError = NotFoundDomain.pipe(
  Schema.encodeTo(ErrorWire, {
    decode: SchemaGetter.transform((wire: { readonly error: string }) => notFound(wire.error)),
    encode: SchemaGetter.transform((domain: NotFound) => ({ error: domain.error }))
  }),
  HttpApiSchema.status(404)
)

const UnavailableDomain = Schema.TaggedStruct("Unavailable", { error: Schema.String })

export type Unavailable = typeof UnavailableDomain["Type"]

export const storeUnavailable = (): Unavailable => UnavailableDomain.make({ error: "store unavailable" })

const unavailableFromWire = (wire: { readonly error: string }): Unavailable =>
  UnavailableDomain.make({ error: wire.error })

export const UnavailableError = UnavailableDomain.pipe(
  Schema.encodeTo(ErrorWire, {
    decode: SchemaGetter.transform(unavailableFromWire),
    encode: SchemaGetter.transform((domain: Unavailable) => ({ error: domain.error }))
  }),
  HttpApiSchema.status(503)
)

export type ApiError = BadRequest | NotFound | Unavailable

// Every operation documents (and the derived client decodes) the same
// envelope family: 400 validation failures, 404 unknown coins/listings, and
// 503 store outages. Handlers only fail with the members they can produce;
// declaring the family uniformly means any `{ error }` status from the
// server (or a gateway in front of it) still decodes to a typed error.
export const EndpointErrors = [BadRequestError, NotFoundError, UnavailableError]

const UpsertCoinPayload = Schema.Struct({
  symbol: Symbol,
  name: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  logo: Schema.String
})

const CoinStatusPayload = Schema.Struct({
  status: Schema.Literals(["active", "inactive"]),
  reason: Schema.String
})

const ListingPatchPayload = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  alternateSymbol: Schema.optional(AlternateSymbol)
})

const ChainPayload = Schema.Struct({ code: Schema.NonEmptyString, name: Schema.NonEmptyString })

const UpsertListingChainPayload = Schema.Struct({
  chainCode: Schema.NonEmptyString,
  exchangeChainCode: Schema.NonEmptyString,
  exchangeChainName: Schema.String,
  withdrawEnabled: Schema.Boolean,
  depositEnabled: Schema.Boolean
})

const UpdateListingChainPayload = Schema.Struct({
  chainCode: Schema.NonEmptyString,
  withdrawEnabled: Schema.Boolean,
  depositEnabled: Schema.Boolean
})

const Coins = HttpApiGroup.make("Coins").add(
  HttpApiEndpoint.get("listCoins", "/coins", {
    query: { status: Schema.optionalKey(Schema.Literals(["active", "inactive"])) },
    success: Schema.Array(Cryptocurrency),
    error: EndpointErrors
  }),
  HttpApiEndpoint.put("upsertCoin", "/coins/:cmcId", {
    params: { cmcId: CmcId },
    payload: UpsertCoinPayload,
    success: Cryptocurrency,
    error: EndpointErrors
  }),
  HttpApiEndpoint.patch("setCoinStatus", "/coins/:cmcId/status", {
    params: { cmcId: CmcId },
    payload: CoinStatusPayload,
    success: Cryptocurrency,
    error: EndpointErrors
  })
)

const Exchanges = HttpApiGroup.make("Exchanges").add(
  HttpApiEndpoint.get("listExchanges", "/exchanges", {
    success: Schema.Array(ExchangeInfo),
    error: EndpointErrors
  }),
  HttpApiEndpoint.get("getExchange", "/exchanges/:exchange", {
    params: { exchange: Schema.String },
    success: ExchangeInfo,
    error: EndpointErrors
  })
)

const Listings = HttpApiGroup.make("Listings").add(
  HttpApiEndpoint.get("listListings", "/listings", {
    query: {
      cmcId: Schema.optionalKey(CmcId),
      exchange: Schema.optionalKey(Schema.String),
      enabled: Schema.optionalKey(Schema.Literals(["true", "false"]))
    },
    success: Schema.Array(Listing),
    error: EndpointErrors
  }),
  HttpApiEndpoint.patch("patchListing", "/listings/:cmcId/:exchange", {
    params: { cmcId: CmcId, exchange: Schema.String },
    payload: ListingPatchPayload,
    success: Listing,
    error: EndpointErrors
  })
)

const Chains = HttpApiGroup.make("Chains").add(
  HttpApiEndpoint.get("listChains", "/chains", {
    success: Schema.Array(Chain),
    error: EndpointErrors
  }),
  HttpApiEndpoint.post("createChain", "/chains", {
    payload: ChainPayload,
    success: Chain.pipe(HttpApiSchema.status(201)),
    error: EndpointErrors
  }),
  HttpApiEndpoint.get("listListingChains", "/listings/:cmcId/:exchange/chains", {
    params: { cmcId: CmcId, exchange: Schema.String },
    success: Schema.Array(ListingChain),
    error: EndpointErrors
  }),
  HttpApiEndpoint.post("upsertListingChain", "/listings/:cmcId/:exchange/chains", {
    params: { cmcId: CmcId, exchange: Schema.String },
    payload: UpsertListingChainPayload,
    success: ListingChain.pipe(HttpApiSchema.status(201)),
    error: EndpointErrors
  }),
  HttpApiEndpoint.patch("updateListingChainFlags", "/listings/:cmcId/:exchange/chains", {
    params: { cmcId: CmcId, exchange: Schema.String },
    payload: UpdateListingChainPayload,
    success: ListingChain,
    error: EndpointErrors
  })
)

// Single definition generating server routes, /docs, the OpenAPI JSON, and
// the derived client. Twelve operations across four groups.
export const Api = HttpApi.make("CoinAdmin").add(Coins).add(Exchanges).add(Listings).add(Chains)
