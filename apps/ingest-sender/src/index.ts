import { Effect } from "effect"
import type { ClientError, CoinAdminClient, Cryptocurrency } from "@rawr/coin-admin-api"

export const packageName = "@rawr/ingest-sender" as const

// Sender boot reads the active coin set over HTTP so the FiberMap starts
// from the registry instead of direct table imports.
export const loadActiveCoins = (
  client: CoinAdminClient
): Effect.Effect<ReadonlyArray<Cryptocurrency>, ClientError> => client.listCoins("active")
