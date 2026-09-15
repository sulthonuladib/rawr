import { Effect, Redacted, Schedule, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { CmcId, OrderbookTick } from "@rawr/domain"
import {
  SubscribeCommand,
  UnsubscribeCommand,
  UpdateCommand,
  applyIpcCommand,
  applySubscribe,
  applyUnsubscribe,
  applyUpdate,
  parseIpcCommand,
  parseSpawnArgs,
  parseSpawnArgsJson,
  reconnectSocket,
  redactedHostOf,
  workerHoldingsFromSpawn,
  workerReconnectSchedule
} from "./worker.js"
import { runWorker } from "./worker-entry.js"
import { CrawlerError } from "./errors.js"

const cmcIdOf = (value: number) => Schema.decodeUnknownSync(CmcId)(value)

describe("exchange worker spawn args", () => {
  it("rejects bad spawn args with Schema", async () => {
    const bad = await Effect.runPromiseExit(parseSpawnArgs({ nope: true }))

    expect(bad._tag).toBe("Failure")

    const badJson = await Effect.runPromiseExit(parseSpawnArgsJson("not-json"))

    expect(badJson._tag).toBe("Failure")

    const missingCoins = await Effect.runPromiseExit(
      parseSpawnArgs({ exchange: "binance", shardId: "binance-1", coins: [{ cmcId: 0, symbol: "" }] })
    )

    expect(missingCoins._tag).toBe("Failure")
  })

  it("boots from valid spawn args and publishes ticks", async () => {
    const argsJson = JSON.stringify({
      exchange: "binance",
      shardId: "binance-1",
      coins: [{ cmcId: 1, symbol: "BTC" }]
    })

    const ticks: Array<OrderbookTick> = []

    const holdings = await Effect.runPromise(
      runWorker("binance", argsJson, (tick) =>
        Effect.sync(() => {
          ticks.push(tick)
        }))
    )

    expect(holdings.coins.get(1)).toBe("BTC")
    expect(ticks).toHaveLength(1)
    expect(ticks[0]?.exchange).toBe("binance")
  })

  it("rejects exchange mismatch on boot", async () => {
    const argsJson = JSON.stringify({
      exchange: "bybit",
      shardId: "bybit-1",
      coins: [{ cmcId: 1, symbol: "BTC" }]
    })

    const exit = await Effect.runPromiseExit(
      runWorker("binance", argsJson, () => Effect.void)
    )

    expect(exit._tag).toBe("Failure")
  })
})

describe("runtime subscribe without restarts", () => {
  it("applies subscribe, update, and unsubscribe in place", async () => {
    const args = await Effect.runPromise(
      parseSpawnArgs({ exchange: "bybit", shardId: "bybit-1", coins: [{ cmcId: 1, symbol: "BTC" }] })
    )

    let holdings = workerHoldingsFromSpawn(args)

    holdings = applySubscribe(holdings, cmcIdOf(2), "ETH")
    expect(holdings.coins.get(2)).toBe("ETH")

    holdings = await Effect.runPromise(applyUpdate(holdings, cmcIdOf(1), "BTC2"))
    expect(holdings.coins.get(1)).toBe("BTC2")

    holdings = applyUnsubscribe(holdings, cmcIdOf(2))
    expect(holdings.coins.has(2)).toBe(false)

    const subscribe = await Effect.runPromise(
      parseIpcCommand(SubscribeCommand.make({ cmcId: cmcIdOf(3), symbol: "SOL" }))
    )

    holdings = await Effect.runPromise(applyIpcCommand(holdings, subscribe))
    expect(holdings.coins.get(3)).toBe("SOL")

    const update = await Effect.runPromise(
      parseIpcCommand(
        UpdateCommand.make({ cmcId: cmcIdOf(3), fromSymbol: "SOL", toSymbol: "SOL2" })
      )
    )

    holdings = await Effect.runPromise(applyIpcCommand(holdings, update))
    expect(holdings.coins.get(3)).toBe("SOL2")

    const remove = await Effect.runPromise(
      parseIpcCommand(UnsubscribeCommand.make({ cmcId: cmcIdOf(3) }))
    )

    holdings = await Effect.runPromise(applyIpcCommand(holdings, remove))
    expect(holdings.coins.has(3)).toBe(false)
  })

  it("rejects malformed IPC with Schema", async () => {
    const exit = await Effect.runPromiseExit(parseIpcCommand({ nope: true }))

    expect(exit._tag).toBe("Failure")
  })
})

describe("worker websocket reconnection", () => {
  it("reconnects internally with reconnecting then connected", async () => {
    let connects = 0
    const statuses: Array<string> = []

    const socket = {
      connect: Effect.gen(function*() {
        connects += 1

        if (connects === 1) {
          return yield* Effect.fail(new CrawlerError({ message: "dial failed" }))
        }
      }),
      disconnect: Effect.void
    }

    await Effect.runPromise(
      reconnectSocket(
        socket,
        (status) =>
          Effect.sync(() => {
            statuses.push(status)
          }),
        Schedule.recurs(5)
      )
    )

    expect(connects).toBe(2)
    expect(statuses).toEqual(["reconnecting", "connected"])
    expect(workerReconnectSchedule).toBeDefined()
  })

  it("keeps secrets Redacted and never interpolates them", async () => {
    const secret = Redacted.make("amqp://guest:guest@localhost:5673")

    expect(Redacted.isRedacted(secret)).toBe(true)
    expect(String(secret)).not.toContain("guest")
    expect(redactedHostOf(secret)).toBe("localhost:5673")
  })
})
