import { Effect, Schema } from "effect"
import type { CmcId, Exchange } from "@rawr/domain"
import { CrawlerError } from "./errors.js"

export const SlotStates = ["pending", "subscribed", "updating", "unsubscribing", "failed"] as const

export const SlotState = Schema.Literals(SlotStates)

export type SlotState = typeof SlotState["Type"]

export const StoredShardStatuses = ["spawning", "running", "full", "dead", "stopped"] as const

export const StoredShardStatus = Schema.Literals(StoredShardStatuses)

export type StoredShardStatus = typeof StoredShardStatus["Type"]

export const ShardStatuses = ["spawning", "running", "full", "degraded", "dead", "stopped"] as const

export const ShardStatus = Schema.Literals(ShardStatuses)

export type ShardStatus = typeof ShardStatus["Type"]

export const DEGRADED_AGE_MS = 30_000

export interface Slot {
  readonly cmcId: CmcId
  readonly symbol: string
  readonly state: SlotState
  readonly lastError: string | undefined
  readonly updatedAt: number
  readonly wantSymbol: string | undefined
}

export interface Shard {
  readonly id: string
  readonly exchange: Exchange
  readonly status: StoredShardStatus
  readonly slots: ReadonlyArray<Slot>
}

export interface RegistryState {
  readonly shards: ReadonlyArray<Shard>
  readonly index: ReadonlyMap<string, string>
}

export const emptyRegistry = (): RegistryState => ({ shards: [], index: new Map() })

export const indexKey = (exchange: Exchange, cmcId: CmcId): string => `${exchange}:${cmcId}`

export const shardSize = (shard: Shard): number => shard.slots.length

export const isShardFull = (shard: Shard, capacity: number): boolean => shardSize(shard) >= capacity

const isUnconfirmed = (state: SlotState): boolean =>
  state === "pending" || state === "updating" || state === "unsubscribing"

export const deriveShardStatus = (
  shard: Shard,
  capacity: number,
  now: number,
  degradedAgeMs: number = DEGRADED_AGE_MS
): ShardStatus => {
  if (shard.status === "dead" || shard.status === "stopped" || shard.status === "spawning") {
    return shard.status
  }

  let hasFailed = false
  let hasAged = false

  for (const slot of shard.slots) {
    if (slot.state === "failed") {
      hasFailed = true
      break
    }
  }

  if (hasFailed === false) {
    for (const slot of shard.slots) {
      if (isUnconfirmed(slot.state) && now - slot.updatedAt > degradedAgeMs) {
        hasAged = true
        break
      }
    }
  }

  if (hasFailed || hasAged) {
    return "degraded"
  }

  if (isShardFull(shard, capacity)) {
    return "full"
  }

  return "running"
}

export const findShard = (state: RegistryState, shardId: string): Shard | undefined => {
  for (const shard of state.shards) {
    if (shard.id === shardId) {
      return shard
    }
  }

  return undefined
}

export const shardsForExchange = (state: RegistryState, exchange: Exchange): Array<Shard> => {
  const out: Array<Shard> = []

  for (const shard of state.shards) {
    if (shard.exchange === exchange) {
      out.push(shard)
    }
  }

  out.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

  return out
}

export const findShardWithRoom = (
  state: RegistryState,
  exchange: Exchange,
  capacity: number
): Shard | undefined => {
  const candidates = shardsForExchange(state, exchange)

  for (const shard of candidates) {
    if (shard.status === "dead" || shard.status === "stopped" || shard.status === "spawning") {
      continue
    }

    if (isShardFull(shard, capacity) === false) {
      return shard
    }
  }

  return undefined
}

const replaceShard = (state: RegistryState, next: Shard): RegistryState => {
  const shards: Array<Shard> = []

  for (const shard of state.shards) {
    if (shard.id === next.id) {
      shards.push(next)
    } else {
      shards.push(shard)
    }
  }

  return { shards, index: state.index }
}

export const createShard = (
  state: RegistryState,
  shardId: string,
  exchange: Exchange
): Effect.Effect<RegistryState, CrawlerError> => {
  if (findShard(state, shardId) !== undefined) {
    return Effect.fail(
      new CrawlerError({ message: `createShard: duplicate shard ${shardId}` })
    )
  }

  const shard: Shard = { id: shardId, exchange, status: "spawning", slots: [] }
  const shards = [...state.shards, shard]

  return Effect.succeed({ shards, index: state.index })
}

export const markShardRunning = (
  state: RegistryState,
  shardId: string
): Effect.Effect<RegistryState, CrawlerError> => {
  const shard = findShard(state, shardId)

  if (shard === undefined) {
    return Effect.fail(new CrawlerError({ message: `markShardRunning: unknown shard ${shardId}` }))
  }

  return Effect.succeed(replaceShard(state, { ...shard, status: "running" }))
}

export const placeSlot = (
  state: RegistryState,
  shardId: string,
  cmcId: CmcId,
  symbol: string,
  capacity: number,
  now: number
): Effect.Effect<RegistryState, CrawlerError> => {
  const shard = findShard(state, shardId)

  if (shard === undefined) {
    return Effect.fail(new CrawlerError({ message: `placeSlot: unknown shard ${shardId}` }))
  }

  if (shard.status === "dead" || shard.status === "stopped") {
    return Effect.fail(
      new CrawlerError({ message: `placeSlot: shard ${shardId} is ${shard.status}` })
    )
  }

  const key = indexKey(shard.exchange, cmcId)
  const owner = state.index.get(key)

  if (owner !== undefined) {
    return Effect.fail(
      new CrawlerError({ message: `placeSlot: cmcId ${cmcId} already owned by ${owner}` })
    )
  }

  if (isShardFull(shard, capacity)) {
    return Effect.fail(new CrawlerError({ message: `placeSlot: shard ${shardId} is full` }))
  }

  const slot: Slot = {
    cmcId,
    symbol,
    state: "pending",
    lastError: undefined,
    updatedAt: now,
    wantSymbol: undefined
  }

  const nextShard: Shard = { ...shard, slots: [...shard.slots, slot] }
  const nextIndex = new Map(state.index)

  nextIndex.set(key, shardId)

  const withShard = replaceShard(state, nextShard)

  return Effect.succeed({ shards: withShard.shards, index: nextIndex })
}

export const firstFitPlace = (
  state: RegistryState,
  exchange: Exchange,
  cmcId: CmcId,
  symbol: string,
  capacity: number,
  now: number
): Effect.Effect<{ readonly state: RegistryState; readonly shardId: string }, CrawlerError> =>
  Effect.gen(function*() {
    const key = indexKey(exchange, cmcId)
    const owner = state.index.get(key)

    if (owner !== undefined) {
      return yield* Effect.fail(
        new CrawlerError({ message: `firstFitPlace: cmcId ${cmcId} already owned by ${owner}` })
      )
    }

    const room = findShardWithRoom(state, exchange, capacity)

    if (room === undefined) {
      return yield* Effect.fail(
        new CrawlerError({ message: `firstFitPlace: no room on ${exchange}`, reason: "full" })
      )
    }

    const next = yield* placeSlot(state, room.id, cmcId, symbol, capacity, now)

    return { state: next, shardId: room.id }
  })

const updateSlot = (
  state: RegistryState,
  shardId: string,
  cmcId: CmcId,
  update: (slot: Slot) => Slot
): Effect.Effect<RegistryState, CrawlerError> =>
  Effect.gen(function*() {
    const shard = findShard(state, shardId)

    if (shard === undefined) {
      return yield* Effect.fail(new CrawlerError({ message: `updateSlot: unknown shard ${shardId}` }))
    }

    let found = false
    const slots: Array<Slot> = []

    for (const slot of shard.slots) {
      if (slot.cmcId === cmcId) {
        found = true
        slots.push(update(slot))
      } else {
        slots.push(slot)
      }
    }

    if (found === false) {
      return yield* Effect.fail(
        new CrawlerError({ message: `updateSlot: cmcId ${cmcId} not on shard ${shardId}` })
      )
    }

    return replaceShard(state, { ...shard, slots })
  })

export const confirmSubscribed = (
  state: RegistryState,
  shardId: string,
  cmcId: CmcId,
  now: number
): Effect.Effect<RegistryState, CrawlerError> =>
  updateSlot(state, shardId, cmcId, (slot) => {
    if (slot.state === "updating" && slot.wantSymbol !== undefined) {
      return {
        cmcId: slot.cmcId,
        symbol: slot.wantSymbol,
        state: "subscribed",
        lastError: undefined,
        updatedAt: now,
        wantSymbol: undefined
      }
    }

    return {
      cmcId: slot.cmcId,
      symbol: slot.symbol,
      state: "subscribed",
      lastError: undefined,
      updatedAt: now,
      wantSymbol: undefined
    }
  })

export const markFailed = (
  state: RegistryState,
  shardId: string,
  cmcId: CmcId,
  reason: string,
  now: number
): Effect.Effect<RegistryState, CrawlerError> =>
  updateSlot(state, shardId, cmcId, (slot) => ({
    cmcId: slot.cmcId,
    symbol: slot.symbol,
    state: "failed",
    lastError: reason,
    updatedAt: now,
    wantSymbol: slot.wantSymbol
  }))

export const beginUpdating = (
  state: RegistryState,
  shardId: string,
  cmcId: CmcId,
  wantSymbol: string,
  now: number
): Effect.Effect<RegistryState, CrawlerError> =>
  Effect.gen(function*() {
    const shard = findShard(state, shardId)

    if (shard === undefined) {
      return yield* Effect.fail(new CrawlerError({ message: `beginUpdating: unknown shard ${shardId}` }))
    }

    let current: Slot | undefined = undefined

    for (const slot of shard.slots) {
      if (slot.cmcId === cmcId) {
        current = slot
      }
    }

    if (current === undefined) {
      return yield* Effect.fail(
        new CrawlerError({ message: `beginUpdating: cmcId ${cmcId} not on shard ${shardId}` })
      )
    }

    if (current.state === "failed") {
      return yield* Effect.fail(
        new CrawlerError({ message: `beginUpdating: cmcId ${cmcId} is failed; disable upstream first` })
      )
    }

    if (current.state !== "subscribed" && current.state !== "updating") {
      return yield* Effect.fail(
        new CrawlerError({
          message: `beginUpdating: cmcId ${cmcId} is ${current.state}, expected subscribed`
        })
      )
    }

    return yield* updateSlot(state, shardId, cmcId, (slot) => ({
      cmcId: slot.cmcId,
      symbol: slot.symbol,
      state: "updating",
      lastError: undefined,
      updatedAt: now,
      wantSymbol
    }))
  })

export const beginUnsubscribing = (
  state: RegistryState,
  shardId: string,
  cmcId: CmcId,
  now: number
): Effect.Effect<RegistryState, CrawlerError> =>
  updateSlot(state, shardId, cmcId, (slot) => ({
    cmcId: slot.cmcId,
    symbol: slot.symbol,
    state: "unsubscribing",
    lastError: undefined,
    updatedAt: now,
    wantSymbol: undefined
  }))

export const confirmRemoved = (
  state: RegistryState,
  shardId: string,
  cmcId: CmcId
): Effect.Effect<RegistryState, CrawlerError> =>
  Effect.gen(function*() {
    const shard = findShard(state, shardId)

    if (shard === undefined) {
      return yield* Effect.fail(new CrawlerError({ message: `confirmRemoved: unknown shard ${shardId}` }))
    }

    let current: Slot | undefined = undefined

    for (const slot of shard.slots) {
      if (slot.cmcId === cmcId) {
        current = slot
      }
    }

    if (current === undefined) {
      return yield* Effect.fail(
        new CrawlerError({ message: `confirmRemoved: cmcId ${cmcId} not on shard ${shardId}` })
      )
    }

    if (current.state !== "unsubscribing") {
      return yield* Effect.fail(
        new CrawlerError({
          message: `confirmRemoved: cmcId ${cmcId} is ${current.state}, expected unsubscribing`
        })
      )
    }

    const slots: Array<Slot> = []

    for (const slot of shard.slots) {
      if (slot.cmcId !== cmcId) {
        slots.push(slot)
      }
    }

    const withShard = replaceShard(state, { ...shard, slots })
    const nextIndex = new Map(withShard.index)

    nextIndex.delete(indexKey(shard.exchange, cmcId))

    return { shards: withShard.shards, index: nextIndex }
  })

export const markShardDead = (
  state: RegistryState,
  shardId: string
): Effect.Effect<RegistryState, CrawlerError> => {
  const shard = findShard(state, shardId)

  if (shard === undefined) {
    return Effect.fail(new CrawlerError({ message: `markShardDead: unknown shard ${shardId}` }))
  }

  return Effect.succeed(replaceShard(state, { ...shard, status: "dead" }))
}

export const removeShard = (
  state: RegistryState,
  shardId: string
): Effect.Effect<RegistryState, CrawlerError> =>
  Effect.gen(function*() {
    const shard = findShard(state, shardId)

    if (shard === undefined) {
      return yield* Effect.fail(new CrawlerError({ message: `removeShard: unknown shard ${shardId}` }))
    }

    const shards: Array<Shard> = []

    for (const entry of state.shards) {
      if (entry.id !== shardId) {
        shards.push(entry)
      }
    }

    const nextIndex = new Map(state.index)

    for (const slot of shard.slots) {
      nextIndex.delete(indexKey(shard.exchange, slot.cmcId))
    }

    return { shards, index: nextIndex }
  })

export const slotOf = (
  state: RegistryState,
  shardId: string,
  cmcId: CmcId
): Slot | undefined => {
  const shard = findShard(state, shardId)

  if (shard === undefined) {
    return undefined
  }

  for (const slot of shard.slots) {
    if (slot.cmcId === cmcId) {
      return slot
    }
  }

  return undefined
}
