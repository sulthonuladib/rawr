/**
 * `@rawr/config` — typed environment and service configuration.
 *
 * Sole owner of `process.env` in this repo (via Effect's default
 * `ConfigProvider.fromEnv`). Every other package imports `Config` /
 * `loadConfig` from here instead of reading the environment directly, so
 * secrets stay `Redacted` and ports stay validated (`1–65535`) in one place.
 *
 * Legacy sources (read-only): `~/Tools/infra/compose.yaml` (service ports,
 * `REDIS_URL` / `AMQP_URL` / `POTENTIAL_HOST` wiring), per-service port
 * literals under `~/Tools` (`coin-lister` 4000, `ticker-cache` 4001, `exchange-sender` 3009,
 * `monitoring-api` 5001, `potential` 10000, `gate-proxy` 42069,
 * `signal-card-ui` nginx 5000), and the `POTENTIAL_HOST || "localhost"`
 * fallback in `galactus/index.ts` + `exchange-sender-websocket/src/utils/reset.js`.
 *
 * Errors are values: `loadConfig` fails with `ConfigError` (a
 * `Schema.TaggedError`), never `throw`. `Redacted` secrets never render into
 * logs (`String(redacted) === "<redacted>"`).
 *
 * @module
 */
import { Config as EffectConfig, Effect, Redacted, Schema } from "effect"

/** Package identifier for `@rawr/config`. */
export const packageName = "@rawr/config" as const

/**
 * Per-service HTTP ports, each read from its own env var with the legacy
 * port as default.
 *
 * Env vars: `COIN_ADMIN_API_PORT` (legacy `coin-lister` 4000),
 * `TICKER_CACHE_PORT` (4001), `INGEST_SENDER_PORT` (legacy
 * `exchange-sender` 3009), `CRAWLER_MONITOR_PORT` (legacy `monitoring-api`
 * 5001), `ARBITRAGE_ENGINE_PORT` (legacy `potential` 10000),
 * `GATE_PROXY_PORT` (legacy `gate-proxy` listens 42069, mapped as
 * `10001:42069`), `SIGNAL_CARD_PORT` (legacy `signal-card-ui` nginx 5000).
 * `ingest-receiver` takes no port (pure AMQP consumer).
 */
export interface Ports {
  /** `COIN_ADMIN_API_PORT`, default `4000` (legacy `coin-lister`). */
  readonly coinAdminApi: number
  /** `TICKER_CACHE_PORT`, default `4001`. */
  readonly tickerCache: number
  /** `INGEST_SENDER_PORT`, default `3009` (legacy `exchange-sender`). */
  readonly ingestSender: number
  /** `CRAWLER_MONITOR_PORT`, default `5001` (legacy `monitoring-api`). */
  readonly crawlerMonitor: number
  /** `ARBITRAGE_ENGINE_PORT`, default `10000` (legacy `potential`). */
  readonly arbitrageEngine: number
  /** `GATE_PROXY_PORT`, default `42069` (legacy `gate-proxy`). */
  readonly gateProxy: number
  /** `SIGNAL_CARD_PORT`, default `5000` (legacy `signal-card-ui` nginx). */
  readonly signalCard: number
}

/**
 * Validated application configuration, loaded once at boot via `loadConfig`.
 *
 * Secrets are `Redacted<string>`: use `Redacted.value(secret)` at the single
 * call site that needs the raw value (DB/Redis/AMQP client, CMC fetch) and
 * never log or interpolate them. Ports are range-checked integers.
 */
export interface Config {
  /**
   * `DATABASE_URL` (`Redacted`).
   *
   * Defaults to `postgres://rawr:rawr@localhost:5432/rawr`, matching
   * `infra/compose.yaml` (`POSTGRES_USER/DB: rawr`, port `5432`).
   */
  readonly databaseUrl: Redacted.Redacted<string>
  /**
   * `REDIS_URL` (`Redacted`).
   *
   * Defaults to `redis://localhost:6379`, matching the legacy
   * `redis://localhost:6379` fallback and compose port `6379`.
   */
  readonly redisUrl: Redacted.Redacted<string>
  /**
   * `AMQP_URL` (`Redacted`).
   *
   * Defaults to `amqp://guest:guest@localhost:5672`, matching compose
   * (`RABBITMQ_DEFAULT_USER/PASS: rawr` in rawr, `guest:guest` upstream) and
   * the legacy `amqp://localhost` fallback family.
   */
  readonly amqpUrl: Redacted.Redacted<string>
  /**
   * `CMC_API_KEY` (`Redacted`, required — no default).
   *
   * The only required secret: `loadConfig` fails with `ConfigError` when it
   * is absent, so misconfigured CMC jobs fail fast at boot, not mid-poll.
   */
  readonly cmcApiKey: Redacted.Redacted<string>
  /**
   * `POTENTIAL_HOST`, default `"localhost"` (legacy fallback in
   * `galactus/index.ts` and `exchange-sender-websocket/src/utils/reset.js`;
   * compose sets `potential` on the shared network).
   *
   * Pair with `ports.arbitrageEngine` to reach the engine
   * (`http://${potentialHost}:${arbitrageEnginePort}`).
   */
  readonly potentialHost: string
  /** Per-service HTTP ports (each with its legacy default). */
  readonly ports: Ports
}

/**
 * Failure loading configuration (missing required key such as `CMC_API_KEY`,
 * or an out-of-range port).
 *
 * Only error pattern in this package: raised via `Effect.fail` inside
 * `loadConfig`, caught with `Effect.catchTag("ConfigError", ...)`. Never
 * `throw`. The message carries the underlying provider/schema cause without
 * secret values.
 */
export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  message: Schema.String
}) {}

/** `DATABASE_URL` descriptor: redacted secret with local-compose default. */
const databaseUrl = EffectConfig.Redacted("DATABASE_URL").pipe(
  EffectConfig.withDefault(Redacted.make("postgres://rawr:rawr@localhost:5432/rawr"))
)

/** `REDIS_URL` descriptor: redacted secret with local default. */
const redisUrl = EffectConfig.Redacted("REDIS_URL").pipe(
  EffectConfig.withDefault(Redacted.make("redis://localhost:6379"))
)

/** `AMQP_URL` descriptor: redacted secret with local default. */
const amqpUrl = EffectConfig.Redacted("AMQP_URL").pipe(
  EffectConfig.withDefault(Redacted.make("amqp://guest:guest@localhost:5672"))
)

/** `CMC_API_KEY` descriptor: required redacted secret (no default). */
const cmcApiKey = EffectConfig.Redacted("CMC_API_KEY")

/** `POTENTIAL_HOST` descriptor: plain string with legacy `"localhost"` default. */
const potentialHost = EffectConfig.String("POTENTIAL_HOST").pipe(
  EffectConfig.withDefault("localhost")
)

/** Per-service port descriptors, each range-checked with its legacy default. */
const ports = EffectConfig.all({
  coinAdminApi: EffectConfig.Port("COIN_ADMIN_API_PORT").pipe(EffectConfig.withDefault(4000)),
  tickerCache: EffectConfig.Port("TICKER_CACHE_PORT").pipe(EffectConfig.withDefault(4001)),
  ingestSender: EffectConfig.Port("INGEST_SENDER_PORT").pipe(EffectConfig.withDefault(3009)),
  crawlerMonitor: EffectConfig.Port("CRAWLER_MONITOR_PORT").pipe(EffectConfig.withDefault(5001)),
  arbitrageEngine: EffectConfig.Port("ARBITRAGE_ENGINE_PORT").pipe(EffectConfig.withDefault(10000)),
  gateProxy: EffectConfig.Port("GATE_PROXY_PORT").pipe(EffectConfig.withDefault(42069)),
  signalCard: EffectConfig.Port("SIGNAL_CARD_PORT").pipe(EffectConfig.withDefault(5000))
})

/** Combined config descriptor (Effect `Config`, i.e. an `Effect` over the default env provider). */
const configDescriptor = EffectConfig.all({
  databaseUrl,
  redisUrl,
  amqpUrl,
  cmcApiKey,
  potentialHost,
  ports
})

/**
 * Load validated configuration from the environment.
 *
 * Reads via Effect's default `ConfigProvider.fromEnv` (the only `env` access
 * in the repo — app code must use this, never `process.env`). Fails with
 * `ConfigError` when a required key (`CMC_API_KEY`) is missing or a value is
 * out of range. Provide a custom provider in tests via
 * `Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(...))`.
 *
 * @returns the validated `Config`, or `ConfigError`
 */
export const loadConfig: Effect.Effect<Config, ConfigError> = configDescriptor.pipe(
  Effect.mapError((cause) => new ConfigError({ message: cause.message }))
)
