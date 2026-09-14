/**
 * `@rawr/coin-store/exchanges` — DB slug ↔ domain exchange mapping.
 *
 * The DB stores the snake_case slug (`upbit_usdt`, matching the AMQP queue
 * name); the domain `Exchange` union keeps the model spelling (`upbitUsdt`,
 * camelCase). These helpers map the one divergent entry at this boundary;
 * all other exchanges are identity. Unknown slugs fail as `InvalidCoinError`
 * (exchange #16 needs its one-line `Exchange` union update first).
 *
 * @module
 */
import { Effect } from "effect"
import { Exchange, Exchanges, InvalidCoinError } from "@rawr/domain"

/**
 * Map a domain exchange to its DB slug.
 *
 * Identity except `upbitUsdt -> "upbit_usdt"` (model spelling vs DB/queue
 * spelling).
 */
export const exchangeToSlug = (exchange: Exchange): string =>
  exchange === "upbitUsdt" ? "upbit_usdt" : exchange

/**
 * Map a DB slug back to its domain exchange.
 *
 * Inverse of `exchangeToSlug`: `"upbit_usdt" -> "upbitUsdt"`, everything else
 * identity. Looks the candidate up in the `Exchanges` tuple (no assertion —
 * the tuple lookup carries the `Exchange` type), so an unknown slug fails as
 * `InvalidCoinError` (exchange #16 needs its one-line `Exchange` union update
 * first).
 */
export const slugToExchange = (slug: string): Effect.Effect<Exchange, InvalidCoinError> => {
  const candidate = slug === "upbit_usdt" ? "upbitUsdt" : slug
  const found = Exchanges.find((entry) => entry === candidate)

  return found === undefined
    ? Effect.fail(new InvalidCoinError({ message: `slugToExchange: unknown exchange slug (${slug})` }))
    : Effect.succeed(found)
}
