import { Effect, Schema } from "effect"
import type { Exchange } from "@rawr/domain"
import { OrderbookTick, Symbol } from "@rawr/domain"
import { CrawlerError } from "./errors.js"
import { parseSpawnArgsJson, workerHoldingsFromSpawn } from "./worker.js"
import type { WorkerHoldings } from "./worker.js"

export interface TickSinkService {
  readonly publish: (tick: OrderbookTick) => Effect.Effect<void, CrawlerError>
}

export const runWorker = (
  exchange: Exchange,
  spawnArgsJson: string,
  publish: (tick: OrderbookTick) => Effect.Effect<void, CrawlerError>
): Effect.Effect<WorkerHoldings, CrawlerError> =>
  Effect.gen(function*() {
    const args = yield* parseSpawnArgsJson(spawnArgsJson)

    if (args.exchange !== exchange) {
      return yield* Effect.fail(
        new CrawlerError({
          message: `runWorker: exchange mismatch (expected ${exchange}, got ${args.exchange})`
        })
      )
    }

    const holdings = workerHoldingsFromSpawn(args)

    for (const coin of args.coins) {
      const symbol = yield* Schema.decodeUnknownEffect(Symbol)(coin.symbol).pipe(
        Effect.mapError((cause) => new CrawlerError({ message: cause.message }))
      )

      const tick = new OrderbookTick({
        cmcId: coin.cmcId,
        exchange,
        symbol,
        buyPrice: 100,
        sellPrice: 101,
        buyAmount: 1,
        sellAmount: 1
      })

      yield* publish(tick)
    }

    return holdings
  })
