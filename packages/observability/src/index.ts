import { Effect, Random, Schema } from "effect"

export const packageName = "@rawr/observability" as const

export class ObserveError extends Schema.TaggedError<ObserveError>()("ObserveError", {
  message: Schema.String,
  operation: Schema.String
}) {}

export const LogId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("LogId")
)

export type LogId = typeof LogId["Type"]

export type LogIdEncoded = typeof LogId["Encoded"]

export const decodeLogId = Schema.decodeUnknownEffect(LogId)

export const parseLogId = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<LogId, ObserveError, typeof LogId["DecodingServices"]> =>
  decodeLogId(input).pipe(
    Effect.mapError((cause) => new ObserveError({ message: cause.message, operation: "parseLogId" }))
  )

const toPaddedHex = (value: number, width: number): string =>
  (value >>> 0).toString(16).padStart(width, "0")

export const makeLogId: Effect.Effect<LogId> = Effect.gen(function*() {
  const seg32 = yield* Random.nextIntBetween(0, 0xffffffff)
  const seg16a = yield* Random.nextIntBetween(0, 0xffff)
  const ver12 = yield* Random.nextIntBetween(0, 0x0fff)
  const var14 = yield* Random.nextIntBetween(0, 0x3fff)
  const node24a = yield* Random.nextIntBetween(0, 0xffffff)
  const node24b = yield* Random.nextIntBetween(0, 0xffffff)

  const uuid =
    `${toPaddedHex(seg32, 8)}-${toPaddedHex(seg16a, 4)}-4${toPaddedHex(ver12, 3)}-` +
    `${toPaddedHex(0x8000 + var14, 4)}-${toPaddedHex(node24a, 6)}${toPaddedHex(node24b, 6)}`

  // SAFETY: version nibble is fixed to `4` and variant bits to `10xx`, with
  // all other nibbles hex from bounded ranges, so `uuid` always matches the
  // `Schema.isUUID()` check on `LogId`. The brand is nominal only; callers
  // cannot construct `LogId` except through this generator or `parseLogId`.
  return uuid as LogId
})

export const CrawlerStatuses = [
  "connected",
  "reconnecting",
  "closed",
  "stopped",
  "error"
] as const

export const CrawlerStatus = Schema.Literals(CrawlerStatuses)

export type CrawlerStatus = typeof CrawlerStatus["Type"]

export type CrawlerStatusEncoded = typeof CrawlerStatus["Encoded"]

export const decodeCrawlerStatus = Schema.decodeUnknownEffect(CrawlerStatus)

export const parseCrawlerStatus = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<CrawlerStatus, ObserveError, typeof CrawlerStatus["DecodingServices"]> =>
  decodeCrawlerStatus(input).pipe(
    Effect.mapError(
      (cause) => new ObserveError({ message: cause.message, operation: "parseCrawlerStatus" })
    )
  )

export class CrawlerReport extends Schema.Class<CrawlerReport>("@rawr/observability/CrawlerReport")({
  market: Schema.NonEmptyString,
  status: CrawlerStatus
}) {}

export type CrawlerReportEncoded = typeof CrawlerReport["Encoded"]

export const decodeCrawlerReport = Schema.decodeUnknownEffect(CrawlerReport)

export const encodeCrawlerReport = Schema.encodeEffect(CrawlerReport)

export const parseCrawlerReport = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser: unknown input is the contract; Schema decodes below.
  input: unknown
): Effect.Effect<CrawlerReport, ObserveError, typeof CrawlerReport["DecodingServices"]> =>
  decodeCrawlerReport(input).pipe(
    Effect.mapError(
      (cause) => new ObserveError({ message: cause.message, operation: "parseCrawlerReport" })
    )
  )

export type LogLevel = "Debug" | "Info" | "Warning" | "Error"

export interface LogFields {
  readonly logId: LogId
  readonly operation: string
  readonly coin?: string
  readonly exchange?: string
  readonly status?: CrawlerStatus
}

export type LogAnnotations = {
  readonly logId: string
  readonly operation: string
  coin?: string
  exchange?: string
  status?: string
}

export const logWith = (
  fields: LogFields,
  message: string,
  level: LogLevel = "Info"
): Effect.Effect<void> => {
  const annotations: LogAnnotations = {
    logId: fields.logId,
    operation: fields.operation
  }

  if (fields.coin !== undefined) {
    annotations.coin = fields.coin
  }

  if (fields.exchange !== undefined) {
    annotations.exchange = fields.exchange
  }

  if (fields.status !== undefined) {
    annotations.status = fields.status
  }

  if (level === "Debug") {
    return Effect.logDebug(message).pipe(Effect.annotateLogs(annotations))
  }

  if (level === "Warning") {
    return Effect.logWarning(message).pipe(Effect.annotateLogs(annotations))
  }

  if (level === "Error") {
    return Effect.logError(message).pipe(Effect.annotateLogs(annotations))
  }

  return Effect.logInfo(message).pipe(Effect.annotateLogs(annotations))
};
