/**
 * `@rawr/messaging` — the `BusEvent` (`CoinUpdated | CrawlerReport`) port with
 * an in-memory `PubSub` implementation for tests/dev and a RabbitMQ adapter
 * skeleton behind the same port.
 *
 * Topology: 15 per-exchange queues in fixed order with per-queue `maxLength`
 * caps, every `assertQueue` with `durable: false`; plus `crawler-logs`
 * (`{ durable: false }`, carrying `CrawlerReport` payloads) and the
 * `coin-updates` lifecycle queue. Reconnect is capped exponential backoff
 * with jitter (`reconnectSchedule`), not a fixed delay.
 *
 * Deliberate design decisions, all documented at the call site:
 *
 * - `CoinUpdated` rides a new `coin-updates` queue — lifecycle events have no
 *   orderbook-tick equivalent, and unlike ticks they must never be
 *   dropped by a `maxLength` cap (a dropped deactivate would leak a live fiber).
 * - Fixed 2s reconnect becomes capped exponential backoff with jitter
 *   (`reconnectSchedule`), so a broker restart does not thundering-herd.
 * - Domain `upbitUsdt` (camelCase) maps to wire `upbit_usdt` at the edge
 *   (`exchangeToQueue`).
 *
 * Rules: every AMQP edge encodes/decodes through `Schema` (parse, don't
 * validate). Errors are values (`Effect.fail` with `MessagingError`), never
 * `throw`. No `process.env` here — the broker URL comes from `@rawr/config`
 * (`loadAmqpUrl`) as `Redacted`; unwrap it only inside the future `amqplib`
 * adapter at its single `connect` call site, and never log it.
 *
 * @module
 */
import { Context, Effect, Layer, PubSub, Redacted, Schedule, Schema, Stream } from "effect"
import type { Scope } from "effect"
import { loadConfig } from "@rawr/config"
import { CoinUpdated, Exchange } from "@rawr/domain"
import { CrawlerReport } from "@rawr/observability"

/** Package identifier for `@rawr/messaging`. */
export const packageName = "@rawr/messaging" as const

/**
 * Failure publishing, subscribing, decoding, or asserting topology on the bus.
 *
 * Only error pattern in this package: raised via `Effect.fail`, caught with
 * `Effect.catchTag("MessagingError", ...)`. Never `throw`. `operation` names
 * the failing step (`"publish"`, `"parseBusEvent"`, `"loadAmqpUrl"`, ...);
 * `message` carries the human-readable cause with no secret values (queue
 * names and exchange keys are safe; the broker URL is `Redacted` and never
 * lands here).
 */
export class MessagingError extends Schema.TaggedError<MessagingError>()("MessagingError", {
  message: Schema.String,
  operation: Schema.String
}) {}

/**
 * Render an unknown failure safely (operation + message only, never secrets).
 *
 * Local helper for the `catch` callbacks below (JSON parsing, future channel
 * errors surfaced as `unknown`).
 *
 * @param cause - the caught value
 * @returns its message when it is an `Error`, else `String(cause)`
 */
const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/**
 * Wire queue names for the 15 per-exchange queues, in fixed order.
 *
 * Note `upbit_usdt` (snake_case on the wire) versus the domain `upbitUsdt`
 * (camelCase) — `exchangeToQueue` maps between them so
 * callers never hand-assemble the wire name.
 */
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

/**
 * Per-exchange wire queue name schema: exactly one of `ExchangeQueueNames`.
 *
 * Decode at the receiver edge (a configured queue name parses into this)
 * so a typo'd queue fails in the `Effect` channel, never via `throw`.
 */
export const ExchangeQueueName = Schema.Literals(ExchangeQueueNames)

/** Type-level per-exchange wire queue name. */
export type ExchangeQueueName = typeof ExchangeQueueName["Type"]

/** Encoded (wire) representation of `ExchangeQueueName`. */
export type ExchangeQueueNameEncoded = typeof ExchangeQueueName["Encoded"]

/**
 * Reusable decoder for `ExchangeQueueName` (defined once, called at edges).
 * Fails with `SchemaError`; use `parseQueueName` for `MessagingError`.
 */
export const decodeQueueName = Schema.decodeUnknownEffect(ExchangeQueueName)

/**
 * Parse unknown edge input into an `ExchangeQueueName`.
 *
 * Maps `SchemaError` into `MessagingError` (`operation: "parseQueueName"`).
 * Intended for the ingest-receiver edge, which maps configured queue strings
 * to wire names before consuming.
 *
 * @param input - untrusted queue name from receiver configuration
 * @returns the decoded queue name, or `MessagingError`
 */
export const parseQueueName = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<ExchangeQueueName, MessagingError, typeof ExchangeQueueName["DecodingServices"]> =>
  decodeQueueName(input).pipe(
    Effect.mapError(
      (cause) => new MessagingError({ message: cause.message, operation: "parseQueueName" })
    )
  )

/**
 * Per-exchange `maxLength` caps (500 for the slower books,
 * 1000 for the fast ones). `Record<ExchangeQueueName, number>` keeps the map
 * total — adding a queue without its cap breaks compilation.
 */
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

/**
 * Crawler telemetry queue (`crawler-logs`), asserted `{ durable: false }`
 * with no `maxLength`. Carries `CrawlerReport` payloads.
 */
export const CrawlerLogsQueue = "crawler-logs" as const

/**
 * New queue for `CoinUpdated` lifecycle events. Coin activate/deactivate is
 * event-driven (nothing mutates the store directly).
 * Asserted `{ durable: false }` with deliberately no `maxLength`: dropping a
 * deactivate would leak a live ingest fiber, so backpressure (not drops) is
 * the only acceptable overload behavior here.
 */
export const CoinUpdatesQueue = "coin-updates" as const

/**
 * Every queue asserted at connect, in assert order: the 15
 * per-exchange queues first (receiver boot-order parity), then
 * `crawler-logs`, then the new `coin-updates`.
 */
export const QueueNames = [...ExchangeQueueNames, CrawlerLogsQueue, CoinUpdatesQueue] as const

/**
 * Any asserted queue name: the 15 per-exchange wire names plus
 * `crawler-logs` and `coin-updates`.
 */
export const QueueName = Schema.Literals(QueueNames)

/** Type-level asserted queue name. */
export type QueueName = typeof QueueName["Type"]

/** Encoded (wire) representation of `QueueName`. */
export type QueueNameEncoded = typeof QueueName["Encoded"]

/**
 * Map a domain exchange to its wire queue name.
 *
 * Total over `Exchange` — the record is checked by the compiler, so a new
 * exchange cannot silently fall through. The only non-identity entry is
 * `upbitUsdt -> "upbit_usdt"` (model spelling vs AMQP spelling).
 *
 * @param exchange - the already-parsed domain exchange
 * @returns its wire queue name
 */
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

/**
 * Options for one `assertQueue` call (`{ durable: false, maxLength? }`).
 */
export interface AssertQueueOptions {
  /** Always `false` in v1, matching every `assertQueue` call. */
  readonly durable: boolean
  /** Length cap for per-exchange queues only; absent for `crawler-logs` / `coin-updates`. */
  readonly maxLength?: number
}

/**
 * Build the `assertQueue` options for one queue.
 *
 * Per-exchange queues get their `maxLength` from `MaxLengthPerQueue`;
 * `crawler-logs` and `coin-updates` (must not drop
 * lifecycle events) assert `{ durable: false }` with no cap.
 *
 * @param queue - the queue to assert
 * @returns its assert options
 */
export const assertQueueOptions = (queue: QueueName): AssertQueueOptions => {
  if (queue === CrawlerLogsQueue || queue === CoinUpdatesQueue) {
    return { durable: false }
  }

  return { durable: false, maxLength: MaxLengthPerQueue[queue] }
}

/**
 * The bus event union: `CoinUpdated` (coin lifecycle, from `@rawr/domain`)
 * or `CrawlerReport` (crawler telemetry, from `@rawr/observability`).
 *
 * The union is unambiguous on the wire despite sharing no discriminator:
 * `CoinUpdated` requires `cmcId` while `CrawlerReport` requires `market`
 * (disjoint required keys), so each payload decodes to exactly one member.
 * Route with `queueForEvent`; narrow with `instanceof CoinUpdated`. Decode at
 * every AMQP edge — never trust bytes off the wire.
 */
export const BusEvent = Schema.Union([CoinUpdated, CrawlerReport])

/** Type-level bus event (`CoinUpdated | CrawlerReport`). */
export type BusEvent = typeof BusEvent["Type"]

/** Encoded (wire) representation of `BusEvent` (plain JSON object with `_tag`). */
export type BusEventEncoded = typeof BusEvent["Encoded"]

/**
 * Reusable decoder for `BusEvent` (defined once, called at subscribe edges).
 * Fails with `SchemaError`; use `parseBusEvent` for `MessagingError`.
 */
export const decodeBusEvent = Schema.decodeUnknownEffect(BusEvent)

/**
 * Reusable encoder for `BusEvent` (domain value back to wire format for publish).
 */
export const encodeBusEvent = Schema.encodeEffect(BusEvent)

/**
 * Parse unknown edge input into a `BusEvent`.
 *
 * Maps `SchemaError` into `MessagingError` (`operation: "parseBusEvent"`) so
 * a poison message fails in the `Effect` channel, never via `throw`.
 *
 * @param input - untrusted JSON-decoded payload from the bus
 * @returns the decoded event, or `MessagingError`
 */
export const parseBusEvent = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<BusEvent, MessagingError, typeof BusEvent["DecodingServices"]> =>
  decodeBusEvent(input).pipe(
    Effect.mapError(
      (cause) => new MessagingError({ message: cause.message, operation: "parseBusEvent" })
    )
  )

/**
 * Route one bus event to its queue: `CoinUpdated` to `coin-updates`,
 * `CrawlerReport` to `crawler-logs`.
 *
 * Narrowed with `instanceof` (`CrawlerReport` is a plain `Schema.Class` with
 * no `_tag`, so tag-switching cannot see it). The `else` branch is exactly
 * `CrawlerReport` while `BusEvent` has two members — extend this function
 * with an explicit branch when a third event joins the union.
 *
 * @param event - the typed event to route
 * @returns its queue
 */
export const queueForEvent = (event: BusEvent): QueueName =>
  event instanceof CoinUpdated ? CoinUpdatesQueue : CrawlerLogsQueue

/**
 * Narrow, application-owned port for raw AMQP channel mechanics.
 *
 * The future `amqplib` adapter implements this (connect with
 * `Redacted.value(loadAmqpUrl)`, `assertQueue`/`sendToQueue`/`consume` against
 * a real channel, ack after handler success, no-ack + redelivery on
 * `MessagingError`). `Messaging.layerRabbitMq` programs against this port, so
 * queue topology, routing, and Schema edges are implemented and reviewed now
 * while the socket mechanics land in a later ticket with no caller changes.
 */
export class AmqpChannel extends Context.Service<AmqpChannel, {
  /**
   * Declare one queue with `{ durable: false, maxLength? }` options.
   *
   * @param queue - queue to declare
   * @param options - `{ durable: false, maxLength? }` from `assertQueueOptions`
   */
  assertQueue(queue: QueueName, options: AssertQueueOptions): Effect.Effect<void, MessagingError>
  /**
   * Publish one JSON body (already `Schema`-encoded by the caller).
   *
   * @param queue - destination queue
   * @param body - JSON text of the encoded event
   */
  sendToQueue(queue: QueueName, body: string): Effect.Effect<void, MessagingError>
  /**
   * Consume one queue until the `Scope` closes.
   *
   * Runs the handler per delivery; the future adapter acks after success and
   * withholds ack (redelivery) on `MessagingError`. The returned `Effect`
   * runs until its `Scope` closes — fork it when consuming several queues.
   *
   * @param queue - queue to consume
   * @param handler - per-message handler over the raw JSON body
   */
  consume(
    queue: QueueName,
    handler: (body: string) => Effect.Effect<void, MessagingError>
  ): Effect.Effect<void, MessagingError, Scope.Scope>
}>()("@rawr/messaging/AmqpChannel") {}

/** Service type of the `AmqpChannel` port (for signatures needing the channel). */
export type AmqpChannelService = AmqpChannel["Service"]

/**
 * The messaging port: publish bus events, subscribe handlers.
 *
 * Publishers (coin-admin API after a tx update, crawler supervisors) emit;
 * subscribers (ingest-sender diffing `CoinUpdated` against running fibers,
 * crawler-monitor fanning out `CrawlerReport`) attach handlers. Two
 * implementations share this port: `Messaging.layerMemory` (in-process
 * `PubSub`, tests/dev) and `Messaging.layerRabbitMq` (AMQP, needs an
 * `AmqpChannel`).
 */
export class Messaging extends Context.Service<Messaging, {
  /**
   * Publish one event to its queue (`queueForEvent`).
   *
   * In-memory: fans out to every subscriber (backpressured, never dropped).
   * RabbitMQ: `Schema`-encodes the event and sends JSON to its queue.
   *
   * @param event - the typed event to publish
   */
  publish(event: BusEvent): Effect.Effect<void, MessagingError>
  /**
   * Subscribe a handler to every bus event until the `Scope` closes.
   *
   * Non-blocking: forks the consumer fiber in the caller's scope, so one
   * call attaches the handler in the background and scope exit detaches it.
   * A handler that fails with `MessagingError` terminates its subscription —
   * callers needing resilience wrap the handler with `Effect.retry`/`catch`.
   *
   * @param handler - per-event handler
   */
  subscribe(
    handler: (event: BusEvent) => Effect.Effect<void, MessagingError>
  ): Effect.Effect<void, MessagingError, Scope.Scope>
}>()("@rawr/messaging/Messaging") {
  /**
   * In-memory `Messaging` for tests/dev: one `PubSub` bus, no broker.
   *
   * Bounded (`capacity: 256`, backpressure strategy) so a burst of
   * `CoinUpdated` events slows publishers instead of dropping lifecycle
   * transitions; `replay: 50` lets a late subscriber (e.g. a restarted
   * ingest-sender) catch up on recent events. Shut down with the layer.
   */
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

  /**
   * RabbitMQ-backed `Messaging` skeleton over the `AmqpChannel` port.
   *
   * Build asserts the full topology (`assertTopology`: 15 per-exchange queues
   * plus `crawler-logs` plus `coin-updates`), retried with
   * `reconnectSchedule` so boot waits out a still-starting broker instead of
   * crashing. Publish encodes via `encodeBusEvent` and routes with
   * `queueForEvent`; subscribe consumes both event queues, parses each body
   * with `parseBusEvent` (Schema at the edge), and runs the handler.
   * Per-exchange queues carry orderbook ticks (not `BusEvent`) — they are
   * asserted here so topology lives in one place, and consumed by the
   * ingest-receiver ticket.
   *
   * Compose with the future client once it exists:
   * `Messaging.layerRabbitMq.pipe(Layer.provide(AmqplibChannelLive))`.
   */
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

/** Service type of the `Messaging` port (for consumers such as ingest-sender). */
export type MessagingService = Messaging["Service"]

/**
 * Assert the full queue topology on one channel, in `TopologyQueues` order.
 *
 * Exported so the future `amqplib` channel layer and seam tests reuse the
 * exact declaration set the `Messaging` layer asserts — one definition, no
 * drift between boot paths.
 *
 * @param channel - the channel port to assert on
 * @returns void, or `MessagingError` when any declaration fails
 */
export const assertTopology = (
  channel: AmqpChannelService
): Effect.Effect<void, MessagingError> =>
  Effect.forEach(TopologyQueues, (queue) => channel.assertQueue(queue, assertQueueOptions(queue)), {
    discard: true
  })

/**
 * Every queue asserted at connect, in assert order: the 15
 * per-exchange wire names, then `crawler-logs`, then `coin-updates`.
 */
export const TopologyQueues: ReadonlyArray<QueueName> = [
  ...ExchangeQueueNames,
  CrawlerLogsQueue,
  CoinUpdatesQueue
]

/**
 * Reconnect backoff for broker connects and topology asserts.
 *
 * Exponential from 500ms capped at 30s with jitter, so a broker restart
 * does not thundering-herd. Unbounded (consumers retry for the
 * process lifetime); compose boot therefore waits out RabbitMQ instead of
 * crash-looping.
 */
export const reconnectSchedule = Schedule.min([
  Schedule.exponential("500 millis"),
  Schedule.spaced("30 seconds")
]).pipe(Schedule.jittered)

/**
 * Decode one raw AMQP body into a `BusEvent`.
 *
 * Two edges in one: `JSON.parse` (a poison body fails as `MessagingError`,
 * never `throw`) then `parseBusEvent` (Schema, parse don't validate).
 *
 * @param body - raw JSON text off the wire
 * @returns the decoded event, or `MessagingError`
 */
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

/**
 * Load the broker URL from `@rawr/config` (sole owner of `process.env`).
 *
 * Fails with `MessagingError` (`operation: "loadAmqpUrl"`) when the
 * environment is misconfigured, so a bad `AMQP_URL` fails fast at boot. The
 * value stays `Redacted` through this package — the future `amqplib` adapter
 * unwraps it once via `Redacted.value` at its `connect` call site and never
 * logs it.
 *
 * @returns the redacted broker URL, or `MessagingError`
 */
export const loadAmqpUrl: Effect.Effect<Redacted.Redacted<string>, MessagingError> = loadConfig.pipe(
  Effect.map((config) => config.amqpUrl),
  Effect.mapError((cause) => new MessagingError({ message: cause.message, operation: "loadAmqpUrl" }))
)
