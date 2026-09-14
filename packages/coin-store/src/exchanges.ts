import { Effect } from "effect"
import { Exchange, Exchanges, InvalidCoinError } from "@rawr/domain"

export const exchangeToSlug = (exchange: Exchange): string =>
  exchange === "upbitUsdt" ? "upbit_usdt" : exchange

export const slugToExchange = (slug: string): Effect.Effect<Exchange, InvalidCoinError> => {
  const candidate = slug === "upbit_usdt" ? "upbitUsdt" : slug
  const found = Exchanges.find((entry) => entry === candidate)

  return found === undefined
    ? Effect.fail(new InvalidCoinError({ message: `slugToExchange: unknown exchange slug (${slug})` }))
    : Effect.succeed(found)
}
