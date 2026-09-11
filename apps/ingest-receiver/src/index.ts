/**
 * `@rawr/ingest-receiver` — ingest receiver.
 *
 * Skeleton placeholder (Phase 0). Phase 2 consumes the ingest stream,
 * `Schema`-decodes each tick at the edge, and upserts an orderbook
 * snapshot. Failures surface as `TaggedError` values, never throws.
 *
 * @module
 */

/** Package identifier for the ingest-receiver skeleton. */
export const packageName = "@rawr/ingest-receiver" as const;
