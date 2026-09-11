/**
 * `@rawr/observability` — logging, tracing and `LogId`.
 *
 * Replaces the legacy `crawler-logs` AMQP queue (`{ market, status }` payloads
 * emitted by `~/Tools/exchange-sender-websocket/src/utils/templates/*.template.js`,
 * consumed by `~/Tools/monips/src/lib/crawler-state.ts`, fanned out over WS by
 * `~/Tools/monips/src/index.ts`) and the trivial console logger in
 * `~/Tools/exchange-sender-websocket/src/utils/logger.js` (`debug/info/warn`
 * wrappers around `console.log`).
 *
 * Rules: every edge decodes through `Schema` (parse, don't validate). Errors
 * are values (`Effect.fail` with `ObserveError`), never `throw`. Structured
 * fields carry only safe values (`LogId`, operation names, coin/exchange tags,
 * `CrawlerStatus`) — never secrets. `LogId` propagates via `Effect`
 * annotations (see `logWith`).
 *
 * @module
 */
import { Effect, Random, Schema } from "effect"

/** Package identifier for `@rawr/observability`. */
export const packageName = "@rawr/observability" as const

/**
 * Failure observing, correlating, or decoding telemetry (bad `LogId` /
 * `CrawlerStatus` / `CrawlerReport` edge input).
 *
 * Only error pattern in this package: raised via `Effect.fail` inside the
 * `parse*` helpers, caught with `Effect.catchTag("ObserveError", ...)`. Never
 * `throw`. Carries the failing `operation` plus a human-readable `message`
 * (no secret values) so handlers can branch without parsing strings.
 */
export class ObserveError extends Schema.TaggedError<ObserveError>()("ObserveError", {
  message: Schema.String,
  operation: Schema.String
}) {}

/**
 * Correlation id carried through `Effect` annotations on every log line.
 *
 * Runtime-checked as a UUID (`Schema.isUUID`, versions 1–8 plus nil/max, so
 * `crypto.randomUUID()` v4 output always passes); the brand keeps log ids
 * distinct from arbitrary strings at the type level.
 */
export const LogId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("LogId")
)

/** Type-level `LogId` (a `string` branded `"LogId"`). */
export type LogId = typeof LogId["Type"]

/** Encoded (wire) representation of `LogId`. */
export type LogIdEncoded = typeof LogId["Encoded"]

/**
 * Reusable decoder for `LogId` (defined once at module load, called at
 * edges). Fails with `SchemaError`; use `parseLogId` in `Effect` code to get
 * the package `ObserveError` instead.
 */
export const decodeLogId = Schema.decodeUnknownEffect(LogId)

/**
 * Parse unknown edge input into a `LogId`.
 *
 * Maps `SchemaError` into `ObserveError` (`operation: "parseLogId"`) so the
 * failure stays in the `Effect` channel as a value — never `throw`.
 *
 * @param input - untrusted input from an HTTP header / WS / AMQP boundary
 * @returns the decoded id, or `ObserveError`
 */
export const parseLogId = (
  input: unknown
): Effect.Effect<LogId, ObserveError, typeof LogId["DecodingServices"]> =>
  decodeLogId(input).pipe(
    Effect.mapError((cause) => new ObserveError({ message: cause.message, operation: "parseLogId" }))
  )

/**
 * Render a non-negative integer as lowercase hex, left-padded to `width`.
 *
 * Local helper for `makeLogId` (not exported): callers pass values already
 * bounded by `Random.nextIntBetween`, so no range check is needed here.
 *
 * @param value - the integer to render
 * @param width - minimum hex digits (padded with `"0"`)
 * @returns the padded hex string
 */
const toPaddedHex = (value: number, width: number): string =>
  (value >>> 0).toString(16).padStart(width, "0")

/**
 * Generate a fresh random `LogId` (UUID v4 shape).
 *
 * Built on the `Random` service (default `Math.random` backend — replace the
 * service with a secure implementation when ids guard anything sensitive;
 * log correlation is not sensitive). Version nibble is fixed to `4` and the
 * variant bits to `10xx`, so output always satisfies the `Schema.isUUID()`
 * check on `LogId`. Deterministic under `Random.withSeed` in tests.
 *
 * Lazy: each run of the `Effect` mints a new id, so call sites capture one
 * per request/job/crawl and thread it through `logWith`. Never fails — id
 * generation has no known failure mode worth an `ObserveError`.
 *
 * @returns a fresh `LogId`
 */
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

/**
 * Canonical crawler lifecycle statuses, in legacy first-seen order.
 *
 * The legacy senders emit ad-hoc strings (`connected`, `subscribed`, `ping`,
 * `pong`, `closed`, `reconnecting`, `error`, `disconnected`, `stopped` — see
 * the `mexc`/`okx` templates) while `monips` only forwards `connected`,
 * `reconnecting`, `closed`, `stopped`. This tuple keeps the four forwarded
 * statuses plus `error` (emitted on socket `error` before `close`) and drops
 * the transient `subscribed` / `ping` / `pong` / `disconnected` noise.
 * Adapters map the dropped wire values at the edge before decoding.
 */
export const CrawlerStatuses = [
  "connected",
  "reconnecting",
  "closed",
  "stopped",
  "error"
] as const

/**
 * Crawler lifecycle status schema: exactly one of `CrawlerStatuses`.
 *
 * Decode at every edge (AMQP `crawler-logs` consumer, WS fan-out) so an
 * unknown status fails in the `Effect` channel, never via `throw`.
 */
export const CrawlerStatus = Schema.Literals(CrawlerStatuses)

/** Type-level `CrawlerStatus` (one of the five canonical statuses). */
export type CrawlerStatus = typeof CrawlerStatus["Type"]

/** Encoded (wire) representation of `CrawlerStatus`. */
export type CrawlerStatusEncoded = typeof CrawlerStatus["Encoded"]

/**
 * Reusable decoder for `CrawlerStatus` (defined once, called at edges).
 * Fails with `SchemaError`; use `parseCrawlerStatus` for `ObserveError`.
 */
export const decodeCrawlerStatus = Schema.decodeUnknownEffect(CrawlerStatus)

/**
 * Parse unknown edge input into a `CrawlerStatus`.
 *
 * Maps `SchemaError` into `ObserveError` (`operation: "parseCrawlerStatus"`).
 *
 * @param input - untrusted `status` from a `crawler-logs` payload
 * @returns the decoded status, or `ObserveError`
 */
export const parseCrawlerStatus = (
  input: unknown
): Effect.Effect<CrawlerStatus, ObserveError, typeof CrawlerStatus["DecodingServices"]> =>
  decodeCrawlerStatus(input).pipe(
    Effect.mapError(
      (cause) => new ObserveError({ message: cause.message, operation: "parseCrawlerStatus" })
    )
  )

/**
 * Normalized `crawler-logs` payload: which crawler (`market`, e.g.
 * `"mexc-0"`) is in which `CrawlerStatus`.
 *
 * Legacy shape is the ad-hoc `{ market, status }` JSON the sender templates
 * push (`Buffer.from(JSON.stringify({ market, status }))`) and `monips`
 * keeps in a `Map<string, string>` for `snapshot` replies plus WS fan-out.
 * This class makes that shape explicit so edges parse instead of validate.
 */
export class CrawlerReport extends Schema.Class<CrawlerReport>("@rawr/observability/CrawlerReport")({
  market: Schema.NonEmptyString,
  status: CrawlerStatus
}) {}

/** Encoded (wire) representation of `CrawlerReport`. */
export type CrawlerReportEncoded = typeof CrawlerReport["Encoded"]

/**
 * Reusable decoder for `CrawlerReport` (defined once, called at edges).
 */
export const decodeCrawlerReport = Schema.decodeUnknownEffect(CrawlerReport)

/**
 * Reusable encoder for `CrawlerReport` (domain value back to wire format).
 */
export const encodeCrawlerReport = Schema.encodeEffect(CrawlerReport)

/**
 * Parse unknown edge input into a `CrawlerReport`.
 *
 * Maps `SchemaError` into `ObserveError` (`operation: "parseCrawlerReport"`).
 *
 * @param input - untrusted input from the `crawler-logs` AMQP boundary
 * @returns the decoded report, or `ObserveError`
 */
export const parseCrawlerReport = (
  input: unknown
): Effect.Effect<CrawlerReport, ObserveError, typeof CrawlerReport["DecodingServices"]> =>
  decodeCrawlerReport(input).pipe(
    Effect.mapError(
      (cause) => new ObserveError({ message: cause.message, operation: "parseCrawlerReport" })
    )
  )

/**
 * Log severity for `logWith`.
 *
 * Maps onto `Effect.logDebug` / `logInfo` / `logWarning` / `logError`.
 * `Debug` for protocol noise (legacy `DEBUG` lines), `Info` for lifecycle
 * transitions, `Warning` for reconnects, `Error` for socket/store failures.
 */
export type LogLevel = "Debug" | "Info" | "Warning" | "Error"

/**
 * Safe structured fields for one log line or annotated scope.
 *
 * Only safe values: ids, operation names, coin/exchange tags, crawler
 * status. Never put secrets here — no tokens, API keys, passwords, raw
 * credentials, or connection strings. Pass `Redacted` values nowhere near
 * this type; unwrap them only inside the adapter making the external call
 * and never interpolate the result into `message` or these fields.
 */
export interface LogFields {
  /** Correlation id for the request/job/crawl (see `makeLogId`). */
  readonly logId: LogId
  /** Operation name (e.g. `"ingest.subscribe"`, `"crawler.reconnect"`). */
  readonly operation: string
  /** Coin tag (e.g. `"BTC"` or `String(cmcId)`); omit when not applicable. */
  readonly coin?: string
  /** Exchange tag (one of the 15 domain exchange keys); omit when not applicable. */
  readonly exchange?: string
  /** Crawler lifecycle status; set for crawler-monitor logs. */
  readonly status?: CrawlerStatus
}

/**
 * Log one line with structured safe fields.
 *
 * Annotates via `Effect.annotateLogs` (`logId`, `operation`, plus whichever
 * of `coin` / `exchange` / `status` are present) so downstream spans keep the
 * correlation, then logs `message` at `level` (default `"Info"`).
 *
 * @param fields - safe structured fields (never secrets — see `LogFields`)
 * @param message - human-readable line; must not interpolate secrets
 * @param level - severity, default `"Info"`
 * @returns an `Effect` that logs; never fails
 */
export const logWith = (
  fields: LogFields,
  message: string,
  level: LogLevel = "Info"
): Effect.Effect<void> => {
  const annotations: Record<string, string> = {
    logId: fields.logId,
    operation: fields.operation
  }
  if (fields.coin !== undefined) {
    annotations["coin"] = fields.coin
  }
  if (fields.exchange !== undefined) {
    annotations["exchange"] = fields.exchange
  }
  if (fields.status !== undefined) {
    annotations["status"] = fields.status
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
