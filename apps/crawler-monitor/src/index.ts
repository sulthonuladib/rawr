/**
 * `@rawr/crawler-monitor` — crawler log fan-out and health.
 *
 * Skeleton placeholder (Phase 0). Phase 2 fans out crawler logs keyed by
 * `LogId` (replaces the legacy `crawler-logs` AMQP queue + `:5001`
 * monitor) and tracks crawler liveness.
 *
 * @module
 */

/** Package identifier for the crawler-monitor skeleton. */
export const packageName = "@rawr/crawler-monitor" as const;
