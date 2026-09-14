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
 * identity. Fails as `InvalidCoinError` when the slug is not one of the 15
 * seeded exchanges.
 */
export const slugToExchange = (slug: string): Effect.Effect<Exchange, InvalidCoinError> => {
  const candidate = slug === "upbit_usdt" ? "upbitUsdt" : slug

  return (Exchanges as ReadonlyArray<string>).includes(candidate)
    ? Effect.succeed(candidate as Exchange)
    : Effect.fail(new InvalidCoinError({ message: `slugToExchange: unknown exchange slug (${slug})` }))
}
