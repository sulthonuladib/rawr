import { Config as EffectConfig, Effect, Redacted, Schema } from "effect"

export const packageName = "@rawr/config" as const

export interface Ports {
  readonly coinAdminApi: number
  readonly tickerCache: number
  readonly ingestSender: number
  readonly crawlerMonitor: number
  readonly arbitrageEngine: number
  readonly gateProxy: number
  readonly signalCard: number
}

export interface Config {
  readonly databaseUrl: Redacted.Redacted<string>
  readonly redisUrl: Redacted.Redacted<string>
  readonly amqpUrl: Redacted.Redacted<string>
  readonly cmcApiKey: Redacted.Redacted<string>
  readonly potentialHost: string
  readonly ports: Ports
}

export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  message: Schema.String
}) {}

const databaseUrl = EffectConfig.Redacted("DATABASE_URL").pipe(
  EffectConfig.withDefault(Redacted.make("postgres://rawr:rawr@localhost:5432/rawr"))
)

const redisUrl = EffectConfig.Redacted("REDIS_URL").pipe(
  EffectConfig.withDefault(Redacted.make("redis://localhost:6379"))
)

const amqpUrl = EffectConfig.Redacted("AMQP_URL").pipe(
  EffectConfig.withDefault(Redacted.make("amqp://guest:guest@localhost:5672"))
)

const cmcApiKey = EffectConfig.Redacted("CMC_API_KEY")

const potentialHost = EffectConfig.String("POTENTIAL_HOST").pipe(
  EffectConfig.withDefault("localhost")
)

const ports = EffectConfig.all({
  coinAdminApi: EffectConfig.Port("COIN_ADMIN_API_PORT").pipe(EffectConfig.withDefault(4000)),
  tickerCache: EffectConfig.Port("TICKER_CACHE_PORT").pipe(EffectConfig.withDefault(4001)),
  ingestSender: EffectConfig.Port("INGEST_SENDER_PORT").pipe(EffectConfig.withDefault(3009)),
  crawlerMonitor: EffectConfig.Port("CRAWLER_MONITOR_PORT").pipe(EffectConfig.withDefault(5001)),
  arbitrageEngine: EffectConfig.Port("ARBITRAGE_ENGINE_PORT").pipe(EffectConfig.withDefault(10000)),
  gateProxy: EffectConfig.Port("GATE_PROXY_PORT").pipe(EffectConfig.withDefault(42069)),
  signalCard: EffectConfig.Port("SIGNAL_CARD_PORT").pipe(EffectConfig.withDefault(5000))
})

const configDescriptor = EffectConfig.all({
  databaseUrl,
  redisUrl,
  amqpUrl,
  cmcApiKey,
  potentialHost,
  ports
})

export const loadConfig: Effect.Effect<Config, ConfigError> = configDescriptor.pipe(
  Effect.mapError((cause) => new ConfigError({ message: cause.message }))
)
