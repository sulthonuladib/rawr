/**
 * `@rawr/arbitrage-engine` — cross-exchange opportunity detector.
 *
 * Skeleton placeholder (Phase 0). Phase 2 joins orderbook snapshot
 * `Stream`s, computes the 2M-volume >= 0.1% spread, upserts the
 * opportunity, and pushes over WS. Merges legacy `potential` + `galactus`.
 *
 * @module
 */

/** Package identifier for the arbitrage-engine skeleton. */
export const packageName = "@rawr/arbitrage-engine" as const;
