import { Effect, Schema } from "effect"
import type { Exchange } from "@rawr/domain"
import { CmcId } from "@rawr/domain"
import type { CoinAdminClient } from "@rawr/coin-admin-api"
import { filterEligible } from "./eligibility.js"
import type { EligibleCoin } from "./eligibility.js"
import { CrawlerError } from "./errors.js"
import { Context, Layer } from "effect"

export interface EligibilitySourceService {
  readonly loadEligible: (
    exchange: Exchange
  ) => Effect.Effect<ReadonlyArray<EligibleCoin>, CrawlerError>
}

export class EligibilitySource extends Context.Service<
  EligibilitySource,
  EligibilitySourceService
>()("@rawr/orderbook-crawler/EligibilitySource") {
  static readonly layerMemory = (
    coins: ReadonlyArray<Parameters<typeof filterEligible>[0][number]>,
    listings: ReadonlyArray<Parameters<typeof filterEligible>[1][number]>
  ): Layer.Layer<EligibilitySource> =>
    Layer.succeed(
      EligibilitySource,
      EligibilitySource.of({
        loadEligible: (exchange) => Effect.succeed(filterEligible(coins, listings, exchange))
      })
    )

  static readonly layerFromClient = (
    client: CoinAdminClient
  ): Layer.Layer<EligibilitySource> =>
    Layer.effect(
      EligibilitySource,
      Effect.succeed(
        EligibilitySource.of({
          loadEligible: (exchange) =>
            Effect.gen(function*() {
              const coins = yield* client.listCoins("active").pipe(
                Effect.mapError(
                  (cause) => new CrawlerError({ message: `loadEligible: ${cause.message}` })
                )
              )

              const listings = yield* client.listListings({ enabled: true }).pipe(
                Effect.mapError(
                  (cause) => new CrawlerError({ message: `loadEligible: ${cause.message}` })
                )
              )

              return filterEligible(coins, listings, exchange)
            })
        })
      )
    )
}

export const decodeCmcId = (value: number): Effect.Effect<CmcId, CrawlerError> =>
  Schema.decodeUnknownEffect(CmcId)(value).pipe(
    Effect.mapError((cause) => new CrawlerError({ message: cause.message }))
  )
