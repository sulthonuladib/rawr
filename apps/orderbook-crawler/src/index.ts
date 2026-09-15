import { Effect } from "effect"
import type { ClientError, CoinAdminClient, Cryptocurrency } from "@rawr/coin-admin-api"

export const packageName = "@rawr/orderbook-crawler" as const

export const loadActiveCoins = (
  client: CoinAdminClient
): Effect.Effect<ReadonlyArray<Cryptocurrency>, ClientError> => client.listCoins("active")

export {
  ImplementedExchanges,
  isImplemented,
  MaxSubsPerSocket,
  maxSubsFor,
  UnimplementedExchanges
} from "./capacity.js"

export {
  AlreadyRunning,
  CrawlerError,
  NotImplementedExchange,
  UnknownExchange
} from "./errors.js"

export {
  beginUnsubscribing,
  beginUpdating,
  confirmRemoved,
  confirmSubscribed,
  createShard,
  DEGRADED_AGE_MS,
  deriveShardStatus,
  emptyRegistry,
  findShard,
  findShardWithRoom,
  firstFitPlace,
  indexKey,
  isShardFull,
  markShardDead,
  markShardRunning,
  markFailed,
  placeSlot,
  removeShard,
  shardSize,
  shardsForExchange,
  slotOf
} from "./registry.js"

export type { RegistryState, Shard, ShardStatus, Slot, SlotState, StoredShardStatus } from "./registry.js"

export { filterEligible, isSpreadEligible, spreadEligibleCmcIds, wireSymbolFor } from "./eligibility.js"

export type { EligibleCoin } from "./eligibility.js"

export {
  HoldingsReport,
  parseHoldingsReport,
  parseIpcCommand,
  parseSpawnArgs,
  parseSpawnArgsJson,
  parseWorkerAck,
  applyIpcCommand,
  applySubscribe,
  applyUnsubscribe,
  applyUpdate,
  loadWorkerSecrets,
  reconnectSocket,
  redactedHostOf,
  workerHoldingsFromSpawn,
  workerReconnectSchedule
} from "./worker.js"

export type { IpcCommand, SpawnArgs, SpawnCoin, WorkerAck, WorkerConnection, WorkerHoldings } from "./worker.js"

export { runWorker } from "./worker-entry.js"

export { EligibilitySource } from "./source.js"

export { isExchangeRunning, Spawner, Supervisor, toSnapshot } from "./supervisor.js"

export type { ShardSnapshot, ShardSnapshotSlot, StartResult, StopResult, SupervisorService } from "./supervisor.js"

export { Api } from "./api.js"

export { ApiGroupsLive, ApiRouterLive, CrawlerApiLive, RoutesLive } from "./server.js"

export { CrawlerLive } from "./routes.js"
