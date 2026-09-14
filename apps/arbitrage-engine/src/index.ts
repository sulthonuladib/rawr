/**
 * `@rawr/arbitrage-engine` — cross-exchange opportunity detector.
 *
 * Joins orderbook snapshot `Stream`s, computes the 2M-volume >= 0.1% spread,
 * upserts the opportunity, and pushes over WS.
 *
 * @module
 */

/** Package identifier for the arbitrage-engine skeleton. */
export const packageName = "@rawr/arbitrage-engine" as const
