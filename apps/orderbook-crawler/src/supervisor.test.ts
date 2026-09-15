import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { CmcId, CoinInactive } from "@rawr/domain"
import { CoinUpdated } from "@rawr/domain"
import { CoinActive } from "@rawr/domain"
import { Symbol } from "@rawr/domain"
import { AlreadyRunning, NotImplementedExchange } from "./errors.js"
import { Spawner, Supervisor } from "./supervisor.js"
import { isSpreadEligible } from "./eligibility.js"
import { emptyRegistry } from "./registry.js"
import type { RegistryState } from "./registry.js"
import { confirmSubscribed, createShard, markShardRunning, placeSlot } from "./registry.js"

const cmcIdOf = (value: number) => Schema.decodeUnknownSync(CmcId)(value)

const symbolOf = (value: string) => Schema.decodeUnknownSync(Symbol)(value)

const eligibleOf = (cmcId: number, wireSymbol: string) => ({
  cmcId: cmcIdOf(cmcId),
  symbol: wireSymbol,
  wireSymbol
})

const runWithSupervisor = <A, E>(
  effect: Effect.Effect<A, E, Supervisor>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function*() {
      const supervisor = yield* Supervisor

      return yield* effect.pipe(Effect.provideService(Supervisor, supervisor))
    }).pipe(
      Effect.provide(Supervisor.layerMemory()),
      Effect.scoped
    )
  )

describe("supervisor state reads", () => {
  it("returns empty running state on fresh boot", async () => {
    const state = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        return yield* supervisor.getState()
      })
    )

    expect(state.shards).toEqual([])
  })

  it("boots empty without persisted shards", async () => {
    const first = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        yield* supervisor.startExchange("bybit", [eligibleOf(1, "BTC")], 1000)

        return yield* supervisor.getState()
      })
    )

    expect(first.shards).toHaveLength(1)

    const second = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        return yield* supervisor.getState()
      })
    )

    expect(second.shards).toEqual([])
  })
})

describe("manual per-exchange start", () => {
  it("spawns shards with coin lists for eligible coins", async () => {
    const result = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        return yield* supervisor.startExchange(
          "bybit",
          [eligibleOf(1, "BTC"), eligibleOf(2, "ETH")],
          2000
        )
      })
    )

    expect(result.exchange).toBe("bybit")
    expect(result.shards).toHaveLength(1)
    expect(result.shards[0]?.coins.map(Number)).toEqual([1, 2])
  })

  it("chunks binance one socket per coin", async () => {
    const result = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        return yield* supervisor.startExchange(
          "binance",
          [eligibleOf(1, "BTC"), eligibleOf(2, "ETH")],
          2000
        )
      })
    )

    expect(result.shards).toHaveLength(2)
  })

  it("rejects already-running without duplicates", async () => {
    const error = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        yield* supervisor.startExchange("bybit", [eligibleOf(1, "BTC")], 2000)

        return yield* Effect.flip(supervisor.startExchange("bybit", [eligibleOf(1, "BTC")], 2001))
      })
    )

    expect(error).toBeInstanceOf(AlreadyRunning)
  })

  it("rejects unimplemented exchanges without spawning", async () => {
    const outcome = await Effect.runPromiseExit(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        return yield* supervisor.startExchange("upbit", [], 2000)
      }).pipe(Effect.provide(Supervisor.layerMemory()), Effect.scoped)
    )

    expect(outcome._tag).toBe("Failure")

    const state = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        return yield* supervisor.getState()
      })
    )

    expect(state.shards).toEqual([])

    const direct = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        return yield* Effect.flip(supervisor.startExchange("pintu", [], 2000))
      })
    )

    expect(direct).toBeInstanceOf(NotImplementedExchange)
  })
})

describe("manual per-exchange stop", () => {
  it("terminates shards and clears them from state", async () => {
    const removed = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        yield* supervisor.startExchange("bybit", [eligibleOf(1, "BTC")], 3000)

        const stopped = yield* supervisor.stopExchange("bybit")
        const state = yield* supervisor.getState()

        expect(state.shards).toEqual([])

        return stopped
      })
    )

    expect(removed.exchange).toBe("bybit")
    expect(removed.removed).toHaveLength(1)
  })
})

describe("scope-finalized child tracking", () => {
  it("terminates children on supervisor shutdown", async () => {
    const killed: Array<string> = []

    const spawnerLayer = Layer.effect(
      Spawner,
      Effect.succeed(
        Spawner.of({
          spawn: () => Effect.void,
          kill: (shardId: string) =>
            Effect.sync(() => {
              killed.push(shardId)
            }),
          liveIds: Effect.succeed([])
        })
      )
    )

    await Effect.runPromise(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        yield* supervisor.startExchange("bybit", [eligibleOf(9, "BTC")], 4000)
      }).pipe(Effect.provide(Supervisor.layerMemory(spawnerLayer)), Effect.scoped)
    )

    expect(killed).toContain("bybit-1")
  })
})

describe("change events and failure visibility", () => {
  it("unsubscribes disabled coins without table wipes", async () => {
    const state = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        yield* supervisor.startExchange("bybit", [eligibleOf(11, "BTC")], 5000)
        yield* supervisor.disableCoin(cmcIdOf(11))

        return yield* supervisor.getState()
      })
    )

    expect(state.shards[0]?.coins[0]?.state).toBe("unsubscribing")
  })

  it("resubscribes symbol changes in place", async () => {
    const state = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor
        const started = yield* supervisor.startExchange("bybit", [eligibleOf(12, "BTC")], 5000)

        const shardId = started.shards[0]?.id ?? "bybit-1"

        yield* supervisor.ackSubscribed(shardId, cmcIdOf(12))
        yield* supervisor.updateCoinSymbol(
          cmcIdOf(12),
          new Map([["bybit", "BTC2"] as const])
        )

        return yield* supervisor.getState()
      })
    )

    expect(state.shards[0]?.coins[0]?.state).toBe("updating")
    expect(state.shards).toHaveLength(1)
  })

  it("consumes CoinUpdated inactive into unsubscribing", async () => {
    const event = new CoinUpdated({
      cmcId: cmcIdOf(13),
      symbol: symbolOf("BTC"),
      status: new CoinInactive({ cmcId: cmcIdOf(13), reason: "delist" }),
      reason: "delist"
    })

    const state = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        yield* supervisor.startExchange("bybit", [eligibleOf(13, "BTC")], 5000)
        yield* supervisor.handleCoinUpdated(event, [], [])

        return yield* supervisor.getState()
      })
    )

    expect(state.shards[0]?.coins[0]?.state).toBe("unsubscribing")
  })

  it("ignores CoinUpdated active without wiping", async () => {
    const event = new CoinUpdated({
      cmcId: cmcIdOf(14),
      symbol: symbolOf("BTC"),
      status: new CoinActive({ cmcId: cmcIdOf(14) }),
      reason: "list"
    })

    const state = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        yield* supervisor.startExchange("bybit", [eligibleOf(14, "BTC")], 5000)
        yield* supervisor.handleCoinUpdated(event, [], [])

        return yield* supervisor.getState()
      })
    )

    expect(state.shards[0]?.coins[0]?.state).toBe("pending")
  })

  it("keeps failed sticky until upstream disable clears it", async () => {
    const afterFail = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor
        const started = yield* supervisor.startExchange("bybit", [eligibleOf(15, "BAD")], 5000)
        const shardId = started.shards[0]?.id ?? "bybit-1"

        yield* supervisor.markSlotFailed(shardId, cmcIdOf(15), "exchange rejected BAD")

        return yield* supervisor.getState()
      })
    )

    expect(afterFail.shards[0]?.coins[0]?.state).toBe("failed")
    expect(afterFail.shards[0]?.coins[0]?.lastError).toBe("exchange rejected BAD")
  })

  it("clears failed on disable then acked removal", async () => {
    const state = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor
        const started = yield* supervisor.startExchange("bybit", [eligibleOf(16, "BAD")], 5000)
        const shardId = started.shards[0]?.id ?? "bybit-1"

        yield* supervisor.markSlotFailed(shardId, cmcIdOf(16), "bad symbol")
        yield* supervisor.disableCoin(cmcIdOf(16))

        const disabling = yield* supervisor.getState()

        expect(disabling.shards[0]?.coins[0]?.state).toBe("unsubscribing")

        yield* supervisor.ackRemoved(shardId, cmcIdOf(16))

        return yield* supervisor.getState()
      })
    )

    expect(state.shards[0]?.coins ?? []).toHaveLength(0)
  })

  it("freezes exited shards as dead and recovers on re-request", async () => {
    const recovered = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor
        const started = yield* supervisor.startExchange("bybit", [eligibleOf(17, "BTC")], 5000)
        const shardId = started.shards[0]?.id ?? "bybit-1"

        yield* supervisor.handleShardExit(shardId)

        const dead = yield* supervisor.getState()

        expect(dead.shards[0]?.status).toBe("dead")
        expect(dead.shards[0]?.coins[0]?.cmcId).toBe(cmcIdOf(17))

        const retry = yield* supervisor.startExchange("bybit", [eligibleOf(17, "BTC")], 6000)

        expect(retry.shards.length).toBeGreaterThan(0)

        return yield* supervisor.getState()
      })
    )

    expect(recovered.shards).toHaveLength(1)
    expect(recovered.shards[0]?.status).not.toBe("dead")
  })
})

describe("two-exchange spread eligibility", () => {
  it("counts a coin only while subscribed on two running exchanges", async () => {
    let bothSubscribed: RegistryState = emptyRegistry()

    bothSubscribed = await Effect.runPromise(
      Effect.gen(function*() {
        let state = emptyRegistry()

        state = yield* createShard(state, "binance-1", "binance")
        state = yield* markShardRunning(state, "binance-1")
        state = yield* placeSlot(state, "binance-1", cmcIdOf(31), "BTC", 1, 1000)
        state = yield* confirmSubscribed(state, "binance-1", cmcIdOf(31), 1001)

        state = yield* createShard(state, "bybit-1", "bybit")
        state = yield* markShardRunning(state, "bybit-1")
        state = yield* placeSlot(state, "bybit-1", cmcIdOf(31), "BTC", 100, 1000)
        state = yield* confirmSubscribed(state, "bybit-1", cmcIdOf(31), 1001)

        state = yield* createShard(state, "bybit-2", "bybit")
        state = yield* markShardRunning(state, "bybit-2")
        state = yield* placeSlot(state, "bybit-2", cmcIdOf(32), "ETH", 100, 1000)

        return state
      })
    )

    expect(isSpreadEligible(bothSubscribed, cmcIdOf(31))).toBe(true)
    expect(isSpreadEligible(bothSubscribed, cmcIdOf(32))).toBe(false)
  })

  it("runs a two-exchange manual-start smoke", async () => {
    const state = await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        yield* supervisor.startExchange("binance", [eligibleOf(41, "BTC")], 7000)
        yield* supervisor.startExchange("bybit", [eligibleOf(41, "BTC"), eligibleOf(42, "ETH")], 7001)

        const started = yield* supervisor.getState()

        expect(started.shards.length).toBeGreaterThanOrEqual(2)

        for (const shard of started.shards) {
          for (const slot of shard.coins) {
            yield* supervisor.ackSubscribed(shard.id, slot.cmcId)
          }
        }

        return yield* supervisor.getState()
      })
    )

    const btcOnlyBoth = state.shards.flatMap((shard) =>
      shard.coins.filter((slot) => slot.state === "subscribed").map((slot) => slot.cmcId)
    )

    expect(btcOnlyBoth).toContain(cmcIdOf(41))
  })
})

describe("failure drill", () => {
  it("fails sticky, clears on disable, and recovers dead shards", async () => {
    await runWithSupervisor(
      Effect.gen(function*() {
        const supervisor = yield* Supervisor
        const started = yield* supervisor.startExchange("bybit", [eligibleOf(51, "BAD")], 8000)
        const shardId = started.shards[0]?.id ?? "bybit-1"

        yield* supervisor.markSlotFailed(shardId, cmcIdOf(51), "bad coin")

        const failed = yield* supervisor.getState()

        expect(failed.shards[0]?.coins[0]?.state).toBe("failed")

        yield* supervisor.disableCoin(cmcIdOf(51))
        yield* supervisor.ackRemoved(shardId, cmcIdOf(51))

        const cleared = yield* supervisor.getState()

        expect(cleared.shards[0]?.coins ?? []).toHaveLength(0)

        yield* supervisor.handleShardExit(shardId)

        const dead = yield* supervisor.getState()

        expect(dead.shards[0]?.status).toBe("dead")

        const retry = yield* supervisor.startExchange("bybit", [eligibleOf(52, "BTC")], 8001)

        expect(retry.shards.length).toBeGreaterThan(0)
      })
    )
  })
})
