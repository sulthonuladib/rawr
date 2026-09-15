import { Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { CmcId, Exchange } from "@rawr/domain"

const ErrorWire = Schema.Struct({ error: Schema.String })

const BadRequestDomain = Schema.TaggedStruct("BadRequest", { error: Schema.String })

export type BadRequest = typeof BadRequestDomain["Type"]

export const badRequest = (message: string): BadRequest =>
  BadRequestDomain.make({ error: message })

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

const ConflictDomain = Schema.TaggedStruct("Conflict", { error: Schema.String })

export type Conflict = typeof ConflictDomain["Type"]

export const conflict = (message: string): Conflict => ConflictDomain.make({ error: message })

export const ConflictError = ConflictDomain.pipe(
  Schema.encodeTo(ErrorWire, {
    decode: SchemaGetter.transform((wire: { readonly error: string }) => conflict(wire.error)),
    encode: SchemaGetter.transform((domain: Conflict) => ({ error: domain.error }))
  }),
  HttpApiSchema.status(409)
)

const NotImplementedDomain = Schema.TaggedStruct("NotImplemented", { error: Schema.String })

export type NotImplemented = typeof NotImplementedDomain["Type"]

export const notImplemented = (message: string): NotImplemented =>
  NotImplementedDomain.make({ error: message })

export const NotImplementedError = NotImplementedDomain.pipe(
  Schema.encodeTo(ErrorWire, {
    decode: SchemaGetter.transform((wire: { readonly error: string }) =>
      notImplemented(wire.error)),
    encode: SchemaGetter.transform((domain: NotImplemented) => ({ error: domain.error }))
  }),
  HttpApiSchema.status(501)
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

export type ApiError = BadRequest | NotFound | Conflict | NotImplemented | Unavailable

export const EndpointErrors = [
  BadRequestError,
  NotFoundError,
  ConflictError,
  NotImplementedError,
  UnavailableError
]

export const SlotSnapshotWire = Schema.Struct({
  cmcId: CmcId,
  symbol: Schema.String,
  state: Schema.String,
  lastError: Schema.optional(Schema.String)
})

export const ShardSnapshotWire = Schema.Struct({
  id: Schema.NonEmptyString,
  exchange: Exchange,
  status: Schema.String,
  coins: Schema.Array(SlotSnapshotWire)
})

export const CrawlerStateWire = Schema.Struct({
  shards: Schema.Array(ShardSnapshotWire)
})

export const StartShardWire = Schema.Struct({
  id: Schema.NonEmptyString,
  coins: Schema.Array(CmcId)
})

export const StartResultWire = Schema.Struct({
  exchange: Exchange,
  shards: Schema.Array(StartShardWire)
})

export const StopResultWire = Schema.Struct({
  exchange: Exchange,
  removed: Schema.Array(Schema.String)
})

const Crawler = HttpApiGroup.make("Crawler").add(
  HttpApiEndpoint.get("getState", "/crawler/state", {
    success: CrawlerStateWire,
    error: EndpointErrors
  }),
  HttpApiEndpoint.post("startExchange", "/exchanges/:exchange/start", {
    params: { exchange: Schema.String },
    success: StartResultWire.pipe(HttpApiSchema.status(201)),
    error: EndpointErrors
  }),
  HttpApiEndpoint.post("stopExchange", "/exchanges/:exchange/stop", {
    params: { exchange: Schema.String },
    success: StopResultWire,
    error: EndpointErrors
  })
)

export const Api = HttpApi.make("OrderbookCrawler").add(Crawler)
