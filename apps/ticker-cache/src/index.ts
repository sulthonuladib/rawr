/**
 * `@rawr/ticker-cache` — scheduled ticker snapshot cache.
 *
 * Refreshes cached tickers on a `Schedule` so hot reads never hit Postgres
 * directly.
 *
 * @module
 */

/** Package identifier for the ticker-cache skeleton. */
export const packageName = "@rawr/ticker-cache" as const
