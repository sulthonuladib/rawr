import { Effect, Match, Redacted, Schedule, Schema } from "effect"
import { CmcId, Exchange } from "@rawr/domain"
import { CrawlerError } from "./errors.js"
import { loadConfig } from "@rawr/config"

export const SpawnCoin = Schema.Struct({
  cmcId: CmcId,
  symbol: Schema.NonEmptyString
})

export type SpawnCoin = typeof SpawnCoin["Type"]

export const SpawnArgs = Schema.Struct({
  exchange: Exchange,
  shardId: Schema.NonEmptyString,
  coins: Schema.Array(SpawnCoin)
})

export type SpawnArgs = typeof SpawnArgs["Type"]

export const decodeSpawnArgs = Schema.decodeUnknownEffect(SpawnArgs)

export const parseSpawnArgs = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown spawn argv is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<SpawnArgs, CrawlerError> =>
  decodeSpawnArgs(input).pipe(
    Effect.mapError((cause) => new CrawlerError({ message: `parseSpawnArgs: ${cause.message}` }))
  )

export const parseSpawnArgsJson = (json: string): Effect.Effect<SpawnArgs, CrawlerError> =>
  Effect.gen(function*() {
    const parsed: unknown = yield* Effect.try({
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- JSON.parse has no narrower honest type; parseSpawnArgs decodes the value below.
      try: (): unknown => JSON.parse(json),
      catch: () => new CrawlerError({ message: "parseSpawnArgsJson: invalid JSON" })
    })

    return yield* parseSpawnArgs(parsed)
  })

export const SubscribeCommand = Schema.TaggedStruct("Subscribe", {
  cmcId: CmcId,
  symbol: Schema.NonEmptyString
})

export type SubscribeCommand = typeof SubscribeCommand["Type"]

export const UnsubscribeCommand = Schema.TaggedStruct("Unsubscribe", {
  cmcId: CmcId
})

export type UnsubscribeCommand = typeof UnsubscribeCommand["Type"]

export const UpdateCommand = Schema.TaggedStruct("Update", {
  cmcId: CmcId,
  fromSymbol: Schema.NonEmptyString,
  toSymbol: Schema.NonEmptyString
})

export type UpdateCommand = typeof UpdateCommand["Type"]

export const IpcCommand = Schema.Union([SubscribeCommand, UnsubscribeCommand, UpdateCommand])

export type IpcCommand = typeof IpcCommand["Type"]

export const decodeIpcCommand = Schema.decodeUnknownEffect(IpcCommand)

export const parseIpcCommand = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC boundary parser: unknown runtime message is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<IpcCommand, CrawlerError> =>
  decodeIpcCommand(input).pipe(
    Effect.mapError((cause) => new CrawlerError({ message: `parseIpcCommand: ${cause.message}` }))
  )

export const WorkerAck = Schema.Struct({
  shardId: Schema.NonEmptyString,
  cmcId: CmcId,
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String)
})

export type WorkerAck = typeof WorkerAck["Type"]

export const decodeWorkerAck = Schema.decodeUnknownEffect(WorkerAck)

export const parseWorkerAck = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC boundary parser: unknown ack payload is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<WorkerAck, CrawlerError> =>
  decodeWorkerAck(input).pipe(
    Effect.mapError((cause) => new CrawlerError({ message: `parseWorkerAck: ${cause.message}` }))
  )

export const HoldingsReport = Schema.Struct({
  shardId: Schema.NonEmptyString,
  holdings: Schema.Array(SpawnCoin)
})

export type HoldingsReport = typeof HoldingsReport["Type"]

export const decodeHoldingsReport = Schema.decodeUnknownEffect(HoldingsReport)

export const parseHoldingsReport = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC boundary parser: unknown holdings payload is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<HoldingsReport, CrawlerError> =>
  decodeHoldingsReport(input).pipe(
    Effect.mapError((cause) => new CrawlerError({ message: `parseHoldingsReport: ${cause.message}` }))
  )

export interface WorkerHoldings {
  readonly exchange: Exchange
  readonly shardId: string
  readonly coins: ReadonlyMap<number, string>
}

export const workerHoldingsFromSpawn = (args: SpawnArgs): WorkerHoldings => {
  const coins = new Map<number, string>()

  for (const coin of args.coins) {
    coins.set(coin.cmcId, coin.symbol)
  }

  return { exchange: args.exchange, shardId: args.shardId, coins }
}

export const applySubscribe = (
  holdings: WorkerHoldings,
  cmcId: number,
  symbol: string
): WorkerHoldings => {
  const coins = new Map(holdings.coins)

  coins.set(cmcId, symbol)

  return { exchange: holdings.exchange, shardId: holdings.shardId, coins }
}

export const applyUnsubscribe = (holdings: WorkerHoldings, cmcId: number): WorkerHoldings => {
  const coins = new Map(holdings.coins)

  coins.delete(cmcId)

  return { exchange: holdings.exchange, shardId: holdings.shardId, coins }
}

export const applyUpdate = (
  holdings: WorkerHoldings,
  cmcId: number,
  toSymbol: string
): Effect.Effect<WorkerHoldings, CrawlerError> => {
  if (holdings.coins.has(cmcId) === false) {
    return Effect.fail(new CrawlerError({ message: `applyUpdate: cmcId ${cmcId} not held` }))
  }

  const coins = new Map(holdings.coins)

  coins.set(cmcId, toSymbol)

  return Effect.succeed({ exchange: holdings.exchange, shardId: holdings.shardId, coins })
}

export const applyIpcCommand = (
  holdings: WorkerHoldings,
  command: IpcCommand
): Effect.Effect<WorkerHoldings, CrawlerError> =>
  Match.value(command).pipe(
    Match.tag("Subscribe", (cmd) =>
      Effect.succeed(applySubscribe(holdings, cmd.cmcId, cmd.symbol))),
    Match.tag("Unsubscribe", (cmd) => Effect.succeed(applyUnsubscribe(holdings, cmd.cmcId))),
    Match.tag("Update", (cmd) => applyUpdate(holdings, cmd.cmcId, cmd.toSymbol)),
    Match.exhaustive
  )

export const workerReconnectSchedule = Schedule.min([
  Schedule.exponential("500 millis"),
  Schedule.spaced("30 seconds")
]).pipe(Schedule.jittered)

export interface WorkerSecrets {
  readonly amqpUrl: Redacted.Redacted<string>
}

export const loadWorkerSecrets: Effect.Effect<WorkerSecrets, CrawlerError> = loadConfig.pipe(
  Effect.map((config) => ({ amqpUrl: config.amqpUrl })),
  Effect.mapError((cause) => new CrawlerError({ message: cause.message }))
)

export const redactedHostOf = (redacted: Redacted.Redacted<string>): string => {
  const value = Redacted.value(redacted)
  const at = value.lastIndexOf("@")

  if (at < 0) {
    return "redacted"
  }

  return value.slice(at + 1)
}

export type WorkerConnection = "connected" | "reconnecting" | "closed"

export interface ExchangeSocket {
  readonly connect: Effect.Effect<void, CrawlerError>
  readonly disconnect: Effect.Effect<void, CrawlerError>
  readonly connection: WorkerConnection
}

export const reconnectSocket = (
  socket: {
    readonly connect: Effect.Effect<void, CrawlerError>
    readonly disconnect: Effect.Effect<void, CrawlerError>
  },
  onStatus: (status: WorkerConnection) => Effect.Effect<void>,
  schedule: Schedule.Schedule<unknown, unknown> = workerReconnectSchedule
): Effect.Effect<void, CrawlerError> =>
  Effect.gen(function*() {
    yield* onStatus("reconnecting")
    yield* socket.disconnect.pipe(Effect.ignore)
    yield* socket.connect.pipe(Effect.retry(schedule))
    yield* onStatus("connected")
  })
