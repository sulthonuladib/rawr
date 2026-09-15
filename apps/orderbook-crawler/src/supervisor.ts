import { Context, Effect, Layer, Predicate, Ref } from "effect"
import type { CmcId, Exchange } from "@rawr/domain"
import type { CoinUpdated } from "@rawr/domain"
import type { Cryptocurrency } from "@rawr/coin-admin-api"
import type { Listing } from "@rawr/coin-admin-api"
import { isImplemented, maxSubsFor } from "./capacity.js"
import type { EligibleCoin } from "./eligibility.js"
import { filterEligible } from "./eligibility.js"
import {
  beginUnsubscribing,
  beginUpdating,
  confirmRemoved,
  confirmSubscribed,
  createShard,
  deriveShardStatus,
  emptyRegistry,
  findShard,
  markShardDead,
  markShardRunning,
  markFailed,
  placeSlot,
  removeShard,
  shardsForExchange
} from "./registry.js"
import type { RegistryState, ShardStatus } from "./registry.js"
import { AlreadyRunning, CrawlerError, NotImplementedExchange } from "./errors.js"
import type { SpawnCoin } from "./worker.js"

export interface ShardSnapshotSlot {
  readonly cmcId: CmcId
  readonly symbol: string
  readonly state: string
  readonly lastError: string | undefined
}

export interface ShardSnapshot {
  readonly id: string
  readonly exchange: Exchange
  readonly status: ShardStatus
  readonly coins: ReadonlyArray<ShardSnapshotSlot>
}

export interface SupervisorSnapshot {
  readonly shards: ReadonlyArray<ShardSnapshot>
}

export const toSnapshot = (state: RegistryState, now: number): SupervisorSnapshot => {
  const shards: Array<ShardSnapshot> = []

  for (const shard of state.shards) {
    const capacity = maxSubsFor(shard.exchange) ?? Number.MAX_SAFE_INTEGER
    const status = deriveShardStatus(shard, capacity, now)
    const coins: Array<ShardSnapshotSlot> = []

    for (const slot of shard.slots) {
      coins.push({
        cmcId: slot.cmcId,
        symbol: slot.symbol,
        state: slot.state,
        lastError: slot.lastError
      })
    }

    coins.sort((left, right) => left.cmcId - right.cmcId)
    shards.push({ id: shard.id, exchange: shard.exchange, status, coins })
  }

  shards.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

  return { shards }
}

export interface SpawnerService {
  readonly spawn: (
    shardId: string,
    exchange: Exchange,
    coins: ReadonlyArray<SpawnCoin>
  ) => Effect.Effect<void, CrawlerError>
  readonly kill: (shardId: string) => Effect.Effect<void, CrawlerError>
  readonly liveIds: Effect.Effect<ReadonlyArray<string>>
}

export class Spawner extends Context.Service<Spawner, SpawnerService>()(
  "@rawr/orderbook-crawler/Spawner"
) {
  static readonly layerMemory = (): Layer.Layer<Spawner> =>
    Layer.effect(
      Spawner,
      Effect.gen(function*() {
        const live = yield* Ref.make<ReadonlyMap<string, boolean>>(new Map())

        return Spawner.of({
          spawn: (shardId) =>
            Ref.update(live, (prev) => new Map(prev).set(shardId, true)).pipe(
              Effect.mapError((cause) => new CrawlerError({ message: String(cause) }))
            ),
          kill: (shardId) =>
            Ref.update(live, (prev) => {
              const next = new Map(prev)

              next.delete(shardId)

              return next
            }).pipe(
              Effect.mapError((cause) => new CrawlerError({ message: String(cause) }))
            ),
          liveIds: Ref.get(live).pipe(Effect.map((entries) => [...entries.keys()]))
        })
      })
    )
}

export interface StartResult {
  readonly exchange: Exchange
  readonly shards: ReadonlyArray<{ readonly id: string; readonly coins: ReadonlyArray<CmcId> }>
}

export interface StopResult {
  readonly exchange: Exchange
  readonly removed: ReadonlyArray<string>
}

export interface SupervisorService {
  readonly getState: () => Effect.Effect<SupervisorSnapshot>
  readonly startExchange: (
    exchange: Exchange,
    eligible: ReadonlyArray<EligibleCoin>,
    now?: number | undefined
  ) => Effect.Effect<StartResult, AlreadyRunning | NotImplementedExchange | CrawlerError>
  readonly stopExchange: (exchange: Exchange) => Effect.Effect<StopResult, CrawlerError>
  readonly ackSubscribed: (shardId: string, cmcId: CmcId) => Effect.Effect<void, CrawlerError>
  readonly ackRemoved: (shardId: string, cmcId: CmcId) => Effect.Effect<void, CrawlerError>
  readonly markSlotFailed: (
    shardId: string,
    cmcId: CmcId,
    reason: string
  ) => Effect.Effect<void, CrawlerError>
  readonly disableCoin: (cmcId: CmcId) => Effect.Effect<void, CrawlerError>
  readonly updateCoinSymbol: (
    cmcId: CmcId,
    wireByExchange: ReadonlyMap<Exchange, string>
  ) => Effect.Effect<void, CrawlerError>
  readonly syncListings: (
    coins: ReadonlyArray<Cryptocurrency>,
    listings: ReadonlyArray<Listing>
  ) => Effect.Effect<void, CrawlerError>
  readonly handleCoinUpdated: (
    event: CoinUpdated,
    coins: ReadonlyArray<Cryptocurrency>,
    listings: ReadonlyArray<Listing>
  ) => Effect.Effect<void, CrawlerError>
  readonly handleShardExit: (shardId: string) => Effect.Effect<void, CrawlerError>
}

const RunningExchanges = [
  "binance",
  "indodax",
  "huobi",
  "bybit",
  "okx",
  "kucoin",
  "mexc",
  "bittime",
  "bitget",
  "gateio",
  "reku",
  "bitmart"
] as const

export class Supervisor extends Context.Service<Supervisor, SupervisorService>()(
  "@rawr/orderbook-crawler/Supervisor"
) {
  static readonly layerMemory = (
    spawnerLayer: Layer.Layer<Spawner> = Spawner.layerMemory()
  ): Layer.Layer<Supervisor, never, never> =>
    Layer.effect(
      Supervisor,
      Effect.gen(function*() {
        const spawner = yield* Spawner.pipe(Effect.provide(spawnerLayer))
        const ref = yield* Ref.make<RegistryState>(emptyRegistry())

        yield* Effect.addFinalizer(() =>
          Effect.gen(function*() {
            const state = yield* Ref.get(ref)

            for (const shard of state.shards) {
              if (shard.status !== "dead" && shard.status !== "stopped") {
                yield* spawner.kill(shard.id).pipe(Effect.ignore)
              }
            }
          })
        )

        const getState = (): Effect.Effect<SupervisorSnapshot> =>
          Ref.get(ref).pipe(Effect.map((state) => toSnapshot(state, Date.now())))

        const startExchange = (
          exchange: Exchange,
          eligible: ReadonlyArray<EligibleCoin>,
          now: number | undefined = undefined
        ): Effect.Effect<StartResult, AlreadyRunning | NotImplementedExchange | CrawlerError> =>
          Effect.gen(function*() {
            if (isImplemented(exchange) === false) {
              return yield* Effect.fail(
                new NotImplementedExchange({
                  exchange,
                  message: `startExchange: ${exchange} has no worker implementation`
                })
              )
            }

            const at = now ?? Date.now()
            const capacity = maxSubsFor(exchange) ?? 1
            const state = yield* Ref.get(ref)
            const existing = shardsForExchange(state, exchange)
            const live: Array<(typeof existing)[number]> = []

            for (const shard of existing) {
              if (shard.status !== "dead" && shard.status !== "stopped") {
                live.push(shard)
              }
            }

            if (live.length > 0) {
              return yield* Effect.fail(
                new AlreadyRunning({
                  exchange,
                  message: `startExchange: ${exchange} already running`
                })
              )
            }

            let nextState = state

            for (const shard of existing) {
              if (shard.status === "dead" || shard.status === "stopped") {
                nextState = yield* removeShard(nextState, shard.id)
              }
            }

            const chunks: Array<Array<EligibleCoin>> = []
            let current: Array<EligibleCoin> = []

            for (const coin of eligible) {
              current.push(coin)

              if (current.length >= capacity) {
                chunks.push(current)
                current = []
              }
            }

            if (current.length > 0) {
              chunks.push(current)
            }

            const spawned: Array<{ readonly id: string; readonly coins: ReadonlyArray<CmcId> }> =
              []

            let shardSeq = existing.length

            for (const chunk of chunks) {
              shardSeq += 1
              const shardId = `${exchange}-${shardSeq}`

              nextState = yield* createShard(nextState, shardId, exchange)

              const spawnCoins: Array<SpawnCoin> = []

              for (const coin of chunk) {
                nextState = yield* placeSlot(
                  nextState,
                  shardId,
                  coin.cmcId,
                  coin.wireSymbol,
                  capacity,
                  at
                )
                spawnCoins.push({ cmcId: coin.cmcId, symbol: coin.wireSymbol })
              }

              yield* spawner.spawn(shardId, exchange, spawnCoins)
              nextState = yield* markShardRunning(nextState, shardId)

              const coinIds: Array<CmcId> = []

              for (const coin of chunk) {
                coinIds.push(coin.cmcId)
              }

              spawned.push({ id: shardId, coins: coinIds })
            }

            yield* Ref.set(ref, nextState)

            return { exchange, shards: spawned }
          })

        const stopExchange = (exchange: Exchange): Effect.Effect<StopResult, CrawlerError> =>
          Effect.gen(function*() {
            const state = yield* Ref.get(ref)
            const targets = shardsForExchange(state, exchange)
            let nextState = state
            const removed: Array<string> = []

            for (const shard of targets) {
              yield* spawner.kill(shard.id).pipe(Effect.ignore)
              nextState = yield* removeShard(nextState, shard.id)
              removed.push(shard.id)
            }

            yield* Ref.set(ref, nextState)

            return { exchange, removed }
          })

        return Supervisor.of({
          getState,
          startExchange,
          stopExchange,
          ackSubscribed: (shardId, cmcId) =>
            Effect.gen(function*() {
              const state = yield* Ref.get(ref)
              const next = yield* confirmSubscribed(state, shardId, cmcId, Date.now())

              yield* Ref.set(ref, next)
            }),
          ackRemoved: (shardId, cmcId) =>
            Effect.gen(function*() {
              const state = yield* Ref.get(ref)
              const next = yield* confirmRemoved(state, shardId, cmcId)

              yield* Ref.set(ref, next)
            }),
          markSlotFailed: (shardId, cmcId, reason) =>
            Effect.gen(function*() {
              const state = yield* Ref.get(ref)
              const next = yield* markFailed(state, shardId, cmcId, reason, Date.now())

              yield* Ref.set(ref, next)
            }),
          disableCoin: (cmcId) =>
            Effect.gen(function*() {
              const state = yield* Ref.get(ref)
              let nextState = state

              for (const shard of state.shards) {
                for (const slot of shard.slots) {
                  if (slot.cmcId === cmcId) {
                    nextState = yield* beginUnsubscribing(nextState, shard.id, cmcId, Date.now())
                  }
                }
              }

              yield* Ref.set(ref, nextState)
            }),
          updateCoinSymbol: (cmcId, wireByExchange) =>
            Effect.gen(function*() {
              const state = yield* Ref.get(ref)
              let nextState = state

              for (const shard of state.shards) {
                const want = wireByExchange.get(shard.exchange)

                if (want === undefined) {
                  continue
                }

                for (const slot of shard.slots) {
                  if (slot.cmcId === cmcId && slot.symbol !== want && slot.state === "subscribed") {
                    nextState = yield* beginUpdating(nextState, shard.id, cmcId, want, Date.now())
                  }
                }
              }

              yield* Ref.set(ref, nextState)
            }),
          syncListings: (coins, listings) =>
            Effect.gen(function*() {
              const state = yield* Ref.get(ref)
              let nextState = state
              const at = Date.now()

              for (const exchange of RunningExchanges) {
                const capacity = maxSubsFor(exchange) ?? 1
                const allForExchange = shardsForExchange(nextState, exchange)
                const running: Array<(typeof allForExchange)[number]> = []

                for (const shard of allForExchange) {
                  if (shard.status !== "dead" && shard.status !== "stopped") {
                    running.push(shard)
                  }
                }

                if (running.length === 0) {
                  continue
                }

                const eligible = filterEligible(coins, listings, exchange)
                const eligibleByCmc = new Map<number, EligibleCoin>()

                for (const coin of eligible) {
                  eligibleByCmc.set(coin.cmcId, coin)
                }

                for (const shard of running) {
                  const freshShard = findShard(nextState, shard.id)

                  if (freshShard === undefined) {
                    continue
                  }

                  for (const slot of freshShard.slots) {
                    const want = eligibleByCmc.get(slot.cmcId)

                    if (want === undefined) {
                      if (slot.state !== "unsubscribing") {
                        nextState = yield* beginUnsubscribing(nextState, shard.id, slot.cmcId, at)
                      }
                    } else if (want.wireSymbol !== slot.symbol && slot.state === "subscribed") {
                      nextState = yield* beginUpdating(
                        nextState,
                        shard.id,
                        slot.cmcId,
                        want.wireSymbol,
                        at
                      )
                    }
                  }
                }

                for (const coin of eligible) {
                  const key = `${exchange}:${coin.cmcId}`

                  if (nextState.index.has(key)) {
                    continue
                  }

                  let roomId: string | undefined = undefined

                  for (const shard of running) {
                    const fresh = findShard(nextState, shard.id)

                    if (fresh !== undefined && fresh.slots.length < capacity) {
                      roomId = fresh.id
                      break
                    }
                  }

                  if (roomId !== undefined) {
                    nextState = yield* placeSlot(
                      nextState,
                      roomId,
                      coin.cmcId,
                      coin.wireSymbol,
                      capacity,
                      at
                    )
                  } else {
                    const shardId = `${exchange}-${nextState.shards.length + 1}`

                    nextState = yield* createShard(nextState, shardId, exchange)
                    nextState = yield* placeSlot(
                      nextState,
                      shardId,
                      coin.cmcId,
                      coin.wireSymbol,
                      capacity,
                      at
                    )
                    yield* spawner.spawn(shardId, exchange, [{
                      cmcId: coin.cmcId,
                      symbol: coin.wireSymbol
                    }])
                    nextState = yield* markShardRunning(nextState, shardId)
                  }
                }
              }

              yield* Ref.set(ref, nextState)
            }),
          handleCoinUpdated: (event) =>
            Effect.gen(function*() {
              if (Predicate.isTagged(event.status, "Inactive") === false) {
                return
              }

              const state = yield* Ref.get(ref)
              let nextState = state
              const at = Date.now()

              for (const shard of state.shards) {
                for (const slot of shard.slots) {
                  if (slot.cmcId === event.cmcId && slot.state !== "unsubscribing") {
                    nextState = yield* beginUnsubscribing(nextState, shard.id, slot.cmcId, at)
                  }
                }
              }

              yield* Ref.set(ref, nextState)
            }),
          handleShardExit: (shardId) =>
            Effect.gen(function*() {
              const state = yield* Ref.get(ref)
              const nextState = yield* markShardDead(state, shardId)

              yield* Ref.set(ref, nextState)
            })
        })
      })
    )
}

export const isExchangeRunning = (state: RegistryState, exchange: Exchange): boolean => {
  for (const shard of state.shards) {
    if (shard.exchange === exchange && shard.status !== "dead" && shard.status !== "stopped") {
      return true
    }
  }

  return false
}
