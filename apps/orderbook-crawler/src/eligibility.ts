import type { CmcId, Exchange } from "@rawr/domain"
import type { Cryptocurrency } from "@rawr/coin-admin-api"
import type { Listing } from "@rawr/coin-admin-api"
import type { RegistryState } from "./registry.js"

export interface EligibleCoin {
  readonly cmcId: CmcId
  readonly symbol: string
  readonly wireSymbol: string
}

export const wireSymbolFor = (coin: Cryptocurrency, listing: Listing): string => {
  const alternate = listing.alternateSymbol.trim()

  if (alternate.length > 0) {
    return alternate
  }

  return coin.symbol
}

export const filterEligible = (
  coins: ReadonlyArray<Cryptocurrency>,
  listings: ReadonlyArray<Listing>,
  exchange: Exchange
): Array<EligibleCoin> => {
  const byCmc = new Map<number, Cryptocurrency>()

  for (const coin of coins) {
    if (coin.status === "active") {
      byCmc.set(coin.cmcId, coin)
    }
  }

  const enabledByCoin = new Map<number, Map<Exchange, Listing>>()

  for (const listing of listings) {
    if (listing.enabled === false) {
      continue
    }

    const coin = byCmc.get(listing.cmcId)

    if (coin === undefined) {
      continue
    }

    const perExchange = enabledByCoin.get(listing.cmcId) ?? new Map<Exchange, Listing>()

    perExchange.set(listing.exchange, listing)
    enabledByCoin.set(listing.cmcId, perExchange)
  }

  const out: Array<EligibleCoin> = []

  for (const [cmcId, perExchange] of enabledByCoin) {
    const here = perExchange.get(exchange)

    if (here === undefined) {
      continue
    }

    if (perExchange.size < 2) {
      continue
    }

    const coin = byCmc.get(cmcId)

    if (coin === undefined) {
      continue
    }

    out.push({ cmcId: coin.cmcId, symbol: coin.symbol, wireSymbol: wireSymbolFor(coin, here) })
  }

  out.sort((left, right) => left.cmcId - right.cmcId)

  return out
}

export const spreadEligibleCmcIds = (state: RegistryState): Set<CmcId> => {
  const perCoin = new Map<CmcId, Set<string>>()

  for (const shard of state.shards) {
    if (shard.status === "dead" || shard.status === "stopped") {
      continue
    }

    for (const slot of shard.slots) {
      if (slot.state !== "subscribed") {
        continue
      }

      const exchanges = perCoin.get(slot.cmcId) ?? new Set<string>()

      exchanges.add(shard.exchange)
      perCoin.set(slot.cmcId, exchanges)
    }
  }

  const eligible = new Set<CmcId>()

  for (const [cmcId, exchanges] of perCoin) {
    if (exchanges.size >= 2) {
      eligible.add(cmcId)
    }
  }

  return eligible
}

export const isSpreadEligible = (state: RegistryState, cmcId: CmcId): boolean =>
  spreadEligibleCmcIds(state).has(cmcId)
