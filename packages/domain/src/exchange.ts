import { Effect, Schema } from "effect"
import { CmcId, Exchange, Symbol } from "./brands.js"
import { InvalidCoinError } from "./errors.js"

export const NonNegativeNumber = Schema.Number.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)

export type NonNegativeNumber = typeof NonNegativeNumber["Type"]

export type NonNegativeNumberEncoded = typeof NonNegativeNumber["Encoded"]

export class OrderbookTick extends Schema.Class<OrderbookTick>("@rawr/domain/OrderbookTick")({
  cmcId: CmcId,
  exchange: Exchange,
  symbol: Symbol,
  buyPrice: NonNegativeNumber,
  sellPrice: NonNegativeNumber,
  buyAmount: NonNegativeNumber,
  sellAmount: NonNegativeNumber
}) {}

export type OrderbookTickEncoded = typeof OrderbookTick["Encoded"]

export const decodeOrderbookTick = Schema.decodeUnknownEffect(OrderbookTick)

export const encodeOrderbookTick = Schema.encodeEffect(OrderbookTick)

export const parseOrderbookTick = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<OrderbookTick, InvalidCoinError, typeof OrderbookTick["DecodingServices"]> =>
  decodeOrderbookTick(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )

export class Opportunity extends Schema.Class<Opportunity>("@rawr/domain/Opportunity")({
  symbol: Symbol,
  cmcId: CmcId,
  buyExchange: Exchange,
  sellExchange: Exchange,
  buyPrice: NonNegativeNumber,
  sellPrice: NonNegativeNumber,
  buyAmount: NonNegativeNumber,
  sellAmount: NonNegativeNumber,
  profitPercentage: Schema.String
}) {}

export type OpportunityEncoded = typeof Opportunity["Encoded"]

export const decodeOpportunity = Schema.decodeUnknownEffect(Opportunity)

export const encodeOpportunity = Schema.encodeEffect(Opportunity)

export const parseOpportunity = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<Opportunity, InvalidCoinError, typeof Opportunity["DecodingServices"]> =>
  decodeOpportunity(input).pipe(
    Effect.mapError((cause) => new InvalidCoinError({ message: cause.message }))
  )
