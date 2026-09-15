import { Effect } from "effect"
import type { OrderbookTick } from "@rawr/domain"
import { CrawlerError } from "../errors.js"
import { runWorker } from "../worker-entry.js"
import type { WorkerHoldings } from "../worker.js"

export const exchange = "huobi" as const

export const boot = (
  spawnArgsJson: string,
  publish: (tick: OrderbookTick) => Effect.Effect<void, CrawlerError>
): Effect.Effect<WorkerHoldings, CrawlerError> => runWorker(exchange, spawnArgsJson, publish)
