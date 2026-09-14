import { Context, Effect, Layer, PubSub, Redacted, Schedule, Schema, Stream } from "effect"
import type { Scope } from "effect"
import { loadConfig } from "@rawr/config"
import { CoinUpdated, Exchange } from "@rawr/domain"
import { CrawlerReport } from "@rawr/observability"

export const packageName = "@rawr/messaging" as const

export class MessagingError extends Schema.TaggedError<MessagingError>()("MessagingError", {
  message: Schema.String,
  operation: Schema.String
}) {}

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const ExchangeQueueNames = [
  "binance",
  "indodax",
  "bittime",
  "huobi",
  "bybit",
  "kucoin",
  "bitget",
  "mexc",
  "gateio",
  "upbit",
  "upbit_usdt",
  "okx",
  "bitmart",
  "pintu",
  "reku"
] as const

export const ExchangeQueueName = Schema.Literals(ExchangeQueueNames)

export type ExchangeQueueName = typeof ExchangeQueueName["Type"]

export type ExchangeQueueNameEncoded = typeof ExchangeQueueName["Encoded"]

export const decodeQueueName = Schema.decodeUnknownEffect(ExchangeQueueName)

export const parseQueueName = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<ExchangeQueueName, MessagingError, typeof ExchangeQueueName["DecodingServices"]> =>
  decodeQueueName(input).pipe(
    Effect.mapError(
      (cause) => new MessagingError({ message: cause.message, operation: "parseQueueName" })
    )
  )

export const MaxLengthPerQueue: Record<ExchangeQueueName, number> = {
  binance: 500,
  indodax: 500,
  bittime: 500,
  huobi: 1000,
  bybit: 1000,
  kucoin: 1000,
  bitget: 1000,
  mexc: 1000,
  gateio: 1000,
  upbit: 500,
  upbit_usdt: 500,
  okx: 1000,
  bitmart: 1000,
  pintu: 500,
  reku: 500
}

export const CrawlerLogsQueue = "crawler-logs" as const

export const CoinUpdatesQueue = "coin-updates" as const

export const QueueNames = [...ExchangeQueueNames, CrawlerLogsQueue, CoinUpdatesQueue] as const

export const QueueName = Schema.Literals(QueueNames)

export type QueueName = typeof QueueName["Type"]

export type QueueNameEncoded = typeof QueueName["Encoded"]

export const exchangeToQueue = (exchange: Exchange): ExchangeQueueName => {
  const wireNameByExchange: Record<Exchange, ExchangeQueueName> = {
    binance: "binance",
    indodax: "indodax",
    huobi: "huobi",
    bybit: "bybit",
    okx: "okx",
    kucoin: "kucoin",
    mexc: "mexc",
    bittime: "bittime",
    bitget: "bitget",
    gateio: "gateio",
    upbit: "upbit",
    upbitUsdt: "upbit_usdt",
    pintu: "pintu",
    reku: "reku",
    bitmart: "bitmart"
  }

  return wireNameByExchange[exchange]
}

export interface AssertQueueOptions {
  readonly durable: boolean
  readonly maxLength?: number
}

export const assertQueueOptions = (queue: QueueName): AssertQueueOptions => {
  if (queue === CrawlerLogsQueue || queue === CoinUpdatesQueue) {
    return { durable: false }
  }

  return { durable: false, maxLength: MaxLengthPerQueue[queue] }
}

export const BusEvent = Schema.Union([CoinUpdated, CrawlerReport])

export type BusEvent = typeof BusEvent["Type"]

export type BusEventEncoded = typeof BusEvent["Encoded"]

export const decodeBusEvent = Schema.decodeUnknownEffect(BusEvent)

export const encodeBusEvent = Schema.encodeEffect(BusEvent)

export const parseBusEvent = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<BusEvent, MessagingError, typeof BusEvent["DecodingServices"]> =>
  decodeBusEvent(input).pipe(
    Effect.mapError(
      (cause) => new MessagingError({ message: cause.message, operation: "parseBusEvent" })
    )
  )

export const queueForEvent = (event: BusEvent): QueueName =>
  event instanceof CoinUpdated ? CoinUpdatesQueue : CrawlerLogsQueue

export class AmqpChannel extends Context.Service<AmqpChannel, {
  assertQueue(queue: QueueName, options: AssertQueueOptions): Effect.Effect<void, MessagingError>
  sendToQueue(queue: QueueName, body: string): Effect.Effect<void, MessagingError>
  consume(
    queue: QueueName,
    handler: (body: string) => Effect.Effect<void, MessagingError>
  ): Effect.Effect<void, MessagingError, Scope.Scope>
}>()("@rawr/messaging/AmqpChannel") {}

export type AmqpChannelService = AmqpChannel["Service"]

export class Messaging extends Context.Service<Messaging, {
  publish(event: BusEvent): Effect.Effect<void, MessagingError>
  subscribe(
    handler: (event: BusEvent) => Effect.Effect<void, MessagingError>
  ): Effect.Effect<void, MessagingError, Scope.Scope>
}>()("@rawr/messaging/Messaging") {
  static readonly layerMemory: Layer.Layer<Messaging, never, never> = Layer.effect(
    Messaging,
    Effect.gen(function*() {
      const pubsub = yield* PubSub.bounded<BusEvent>({ capacity: 256, replay: 50 })
      yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))

      const publish = (event: BusEvent): Effect.Effect<void, MessagingError> =>
        Effect.asVoid(PubSub.publish(pubsub, event))

      const subscribe = (
        handler: (event: BusEvent) => Effect.Effect<void, MessagingError>
      ): Effect.Effect<void, MessagingError, Scope.Scope> =>
        Effect.asVoid(Effect.forkScoped(Stream.fromPubSub(pubsub).pipe(Stream.runForEach(handler))))

      return Messaging.of({ publish, subscribe })
    })
  )

  static readonly layerRabbitMq: Layer.Layer<Messaging, MessagingError, AmqpChannel> = Layer.effect(
    Messaging,
    Effect.gen(function*() {
      const channel = yield* AmqpChannel
      yield* assertTopology(channel).pipe(Effect.retry(reconnectSchedule))

      const publish = (event: BusEvent): Effect.Effect<void, MessagingError> =>
        Effect.gen(function*() {
          const encoded = yield* encodeBusEvent(event).pipe(
            Effect.mapError(
              (cause) => new MessagingError({ message: cause.message, operation: "publish" })
            )
          )

          yield* channel.sendToQueue(queueForEvent(event), JSON.stringify(encoded))
        })

      const consumeWith = (
        handler: (event: BusEvent) => Effect.Effect<void, MessagingError>
      ) =>
        (body: string): Effect.Effect<void, MessagingError> =>
          Effect.flatMap(decodePayload(body), handler)

      const subscribe = (
        handler: (event: BusEvent) => Effect.Effect<void, MessagingError>
      ): Effect.Effect<void, MessagingError, Scope.Scope> =>
        Effect.asVoid(Effect.andThen(
          Effect.forkScoped(channel.consume(CoinUpdatesQueue, consumeWith(handler))),
          Effect.forkScoped(channel.consume(CrawlerLogsQueue, consumeWith(handler)))
        ))

      return Messaging.of({ publish, subscribe })
    })
  )
}

export type MessagingService = Messaging["Service"]

export const assertTopology = (
  channel: AmqpChannelService
): Effect.Effect<void, MessagingError> =>
  Effect.forEach(TopologyQueues, (queue) => channel.assertQueue(queue, assertQueueOptions(queue)), {
    discard: true
  })

export const TopologyQueues: ReadonlyArray<QueueName> = [
  ...ExchangeQueueNames,
  CrawlerLogsQueue,
  CoinUpdatesQueue
]

export const reconnectSchedule = Schedule.min([
  Schedule.exponential("500 millis"),
  Schedule.spaced("30 seconds")
]).pipe(Schedule.jittered)

const decodePayload = (body: string): Effect.Effect<BusEvent, MessagingError> =>
  Effect.try({
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- JSON.parse has no narrower honest type; parseBusEvent decodes the value below.
    try: (): unknown => JSON.parse(body),
    catch: (cause) =>
      new MessagingError({
        message: `decodePayload: invalid JSON (${describeCause(cause)})`,
        operation: "decodePayload"
      })
  }).pipe(Effect.flatMap(parseBusEvent))

export const loadAmqpUrl: Effect.Effect<Redacted.Redacted<string>, MessagingError> = loadConfig.pipe(
  Effect.map((config) => config.amqpUrl),
  Effect.mapError((cause) => new MessagingError({ message: cause.message, operation: "loadAmqpUrl" }))
)
