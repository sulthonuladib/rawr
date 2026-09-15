import { Config as EffectConfig, Effect, Redacted, Schema } from "effect"

export const packageName = "@rawr/config" as const

export interface Ports {
  readonly coinAdminApi: number
  readonly tickerCache: number
  readonly orderbookCrawler: number
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

export interface CoinAdminApiConfig {
  readonly port: number
  readonly host: string
}

const databaseUrl = EffectConfig.Redacted("DATABASE_URL").pipe(
  EffectConfig.withDefault(Redacted.make("postgres://rawr:rawr@localhost:5433/rawr"))
)

const redisUrl = EffectConfig.Redacted("REDIS_URL").pipe(
  EffectConfig.withDefault(Redacted.make("redis://localhost:6380"))
)

const amqpUrl = EffectConfig.Redacted("AMQP_URL").pipe(
  EffectConfig.withDefault(Redacted.make("amqp://guest:guest@localhost:5673"))
)

const cmcApiKey = EffectConfig.Redacted("CMC_API_KEY")

const potentialHost = EffectConfig.String("POTENTIAL_HOST").pipe(
  EffectConfig.withDefault("localhost")
)

const coinAdminApiPort = EffectConfig.Port("COIN_ADMIN_API_PORT").pipe(EffectConfig.withDefault(4100))

const coinAdminApiHost = EffectConfig.String("COIN_ADMIN_API_HOST").pipe(
  EffectConfig.withDefault("0.0.0.0")
)

const ports = EffectConfig.all({
  coinAdminApi: coinAdminApiPort,
  tickerCache: EffectConfig.Port("TICKER_CACHE_PORT").pipe(EffectConfig.withDefault(4101)),
  orderbookCrawler: EffectConfig.Port("ORDERBOOK_CRAWLER_PORT").pipe(EffectConfig.withDefault(3109)),
  arbitrageEngine: EffectConfig.Port("ARBITRAGE_ENGINE_PORT").pipe(EffectConfig.withDefault(10100)),
  gateProxy: EffectConfig.Port("GATE_PROXY_PORT").pipe(EffectConfig.withDefault(42169)),
  signalCard: EffectConfig.Port("SIGNAL_CARD_PORT").pipe(EffectConfig.withDefault(5100))
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

// Narrow loader for booting the admin API without the credentials the full
// Config requires (e.g. CMC_API_KEY, which this service never uses).
export const loadCoinAdminApiConfig: Effect.Effect<CoinAdminApiConfig, ConfigError> =
  EffectConfig.all({ port: coinAdminApiPort, host: coinAdminApiHost }).pipe(
    Effect.mapError((cause) => new ConfigError({ message: cause.message }))
  )
