import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { CmcId } from "@rawr/domain"
import {
  beginUnsubscribing,
  beginUpdating,
  confirmRemoved,
  confirmSubscribed,
  createShard,
  deriveShardStatus,
  emptyRegistry,
  findShardWithRoom,
  firstFitPlace,
  isShardFull,
  markFailed,
  markShardRunning,
  placeSlot
} from "./registry.js"

const cmcIdOf = (value: number) => Schema.decodeUnknownSync(CmcId)(value)

const now = 1_700_000_000_000

describe("shard registry first-fit and capacity", () => {
  it("fills existing socket first and spawns only when full", async () => {
    const capacity = 2

    const placed = await Effect.runPromise(
      Effect.gen(function*() {
        let state = emptyRegistry()

        state = yield* createShard(state, "bybit-1", "bybit")
        state = yield* markShardRunning(state, "bybit-1")
        state = yield* createShard(state, "bybit-2", "bybit")
        state = yield* markShardRunning(state, "bybit-2")

        const first = yield* firstFitPlace(state, "bybit", cmcIdOf(1), "BTC", capacity, now)

        state = first.state
        expect(first.shardId).toBe("bybit-1")

        const second = yield* firstFitPlace(state, "bybit", cmcIdOf(2), "ETH", capacity, now)

        state = second.state
        expect(second.shardId).toBe("bybit-1")

        const fullShard = state.shards[0]

        if (fullShard === undefined) {
          return yield* Effect.fail(new Error("missing shard"))
        }

        expect(isShardFull(fullShard, capacity)).toBe(true)

        const third = yield* firstFitPlace(state, "bybit", cmcIdOf(3), "SOL", capacity, now)

        expect(third.shardId).toBe("bybit-2")

        return third.state
      })
    )

    expect(placed.index.size).toBe(3)
  })

  it("detects full shards and enforces single owner", async () => {
    const capacity = 1

    await Effect.runPromise(
      Effect.gen(function*() {
        let state = emptyRegistry()

        state = yield* createShard(state, "binance-1", "binance")
        state = yield* markShardRunning(state, "binance-1")
        state = yield* placeSlot(state, "binance-1", cmcIdOf(10), "BTC", capacity, now)

        const shard = state.shards[0]

        if (shard === undefined) {
          return yield* Effect.fail(new Error("missing shard"))
        }

        expect(isShardFull(shard, capacity)).toBe(true)
        expect(findShardWithRoom(state, "binance", capacity)).toBeUndefined()

        const duplicate = yield* Effect.flip(placeSlot(state, "binance-1", cmcIdOf(10), "BTC", capacity, now))

        expect(duplicate.message).toContain("already owned")

        const full = yield* Effect.flip(
          firstFitPlace(state, "binance", cmcIdOf(11), "ETH", capacity, now)
        )

        expect(full.message).toContain("no room")
      })
    )
  })
})

describe("option B slot transitions", () => {
  it("moves pending to subscribed on ack", async () => {
    await Effect.runPromise(
      Effect.gen(function*() {
        let state = emptyRegistry()

        state = yield* createShard(state, "okx-1", "okx")
        state = yield* markShardRunning(state, "okx-1")
        state = yield* placeSlot(state, "okx-1", cmcIdOf(21), "BTC", 30, now)
        state = yield* confirmSubscribed(state, "okx-1", cmcIdOf(21), now + 1)

        const shard = state.shards[0]

        if (shard === undefined) {
          return yield* Effect.fail(new Error("missing shard"))
        }

        expect(shard.slots[0]?.state).toBe("subscribed")
      })
    )
  })

  it("resubscribes symbol change in place via updating", async () => {
    await Effect.runPromise(
      Effect.gen(function*() {
        let state = emptyRegistry()

        state = yield* createShard(state, "okx-1", "okx")
        state = yield* markShardRunning(state, "okx-1")
        state = yield* placeSlot(state, "okx-1", cmcIdOf(22), "BTC", 30, now)
        state = yield* confirmSubscribed(state, "okx-1", cmcIdOf(22), now + 1)
        state = yield* beginUpdating(state, "okx-1", cmcIdOf(22), "BTC2", now + 2)

        const updating = state.shards[0]?.slots[0]

        expect(updating?.state).toBe("updating")

        state = yield* confirmSubscribed(state, "okx-1", cmcIdOf(22), now + 3)

        const done = state.shards[0]?.slots[0]

        expect(done?.state).toBe("subscribed")
        expect(done?.symbol).toBe("BTC2")
      })
    )
  })

  it("deletes only on acked removal", async () => {
    await Effect.runPromise(
      Effect.gen(function*() {
        let state = emptyRegistry()

        state = yield* createShard(state, "okx-1", "okx")
        state = yield* markShardRunning(state, "okx-1")
        state = yield* placeSlot(state, "okx-1", cmcIdOf(23), "BTC", 30, now)
        state = yield* confirmSubscribed(state, "okx-1", cmcIdOf(23), now + 1)
        state = yield* beginUnsubscribing(state, "okx-1", cmcIdOf(23), now + 2)

        expect(state.shards[0]?.slots[0]?.state).toBe("unsubscribing")

        state = yield* confirmRemoved(state, "okx-1", cmcIdOf(23))

        expect(state.shards[0]?.slots).toHaveLength(0)
        expect(state.index.size).toBe(0)
      })
    )
  })

  it("keeps failed sticky until upstream disable", async () => {
    await Effect.runPromise(
      Effect.gen(function*() {
        let state = emptyRegistry()

        state = yield* createShard(state, "okx-1", "okx")
        state = yield* markShardRunning(state, "okx-1")
        state = yield* placeSlot(state, "okx-1", cmcIdOf(24), "BAD", 30, now)
        state = yield* markFailed(state, "okx-1", cmcIdOf(24), "exchange rejected BAD", now + 1)

        const failed = state.shards[0]?.slots[0]

        expect(failed?.state).toBe("failed")
        expect(failed?.lastError).toBe("exchange rejected BAD")

        const updatingFailed = yield* Effect.flip(
          beginUpdating(state, "okx-1", cmcIdOf(24), "BAD2", now + 2)
        )

        expect(updatingFailed.message).toContain("failed")

        state = yield* beginUnsubscribing(state, "okx-1", cmcIdOf(24), now + 3)

        expect(state.shards[0]?.slots[0]?.state).toBe("unsubscribing")

        state = yield* confirmRemoved(state, "okx-1", cmcIdOf(24))

        expect(state.index.size).toBe(0)
      })
    )
  })

  it("derives degraded from failed or aged unconfirmed", async () => {
    await Effect.runPromise(
      Effect.gen(function*() {
        let state = emptyRegistry()

        state = yield* createShard(state, "okx-1", "okx")
        state = yield* markShardRunning(state, "okx-1")
        state = yield* placeSlot(state, "okx-1", cmcIdOf(25), "BTC", 30, now)
        state = yield* confirmSubscribed(state, "okx-1", cmcIdOf(25), now)

        const running = state.shards[0]

        if (running === undefined) {
          return yield* Effect.fail(new Error("missing shard"))
        }

        expect(deriveShardStatus(running, 30, now + 1_000)).toBe("running")

        const failedState = yield* markFailed(state, "okx-1", cmcIdOf(25), "boom", now + 2_000)
        const failedShard = failedState.shards[0]

        if (failedShard === undefined) {
          return yield* Effect.fail(new Error("missing shard"))
        }

        expect(deriveShardStatus(failedShard, 30, now + 3_000)).toBe("degraded")

        let aged = emptyRegistry()

        aged = yield* createShard(aged, "okx-2", "okx")
        aged = yield* markShardRunning(aged, "okx-2")
        aged = yield* placeSlot(aged, "okx-2", cmcIdOf(26), "ETH", 30, now)

        const pending = aged.shards[0]

        if (pending === undefined) {
          return yield* Effect.fail(new Error("missing shard"))
        }

        expect(deriveShardStatus(pending, 30, now + 60_000)).toBe("degraded")
      })
    )
  })
})
