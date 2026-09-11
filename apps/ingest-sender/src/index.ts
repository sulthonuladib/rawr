/**
 * `@rawr/ingest-sender` — ingest sender with `FiberMap` lifecycle.
 *
 * Skeleton placeholder (Phase 0). Phase 2 subscribes to `CoinUpdated` and
 * diffs the active set: activate / deactivate only the delta via a
 * `FiberMap`, with `Schedule` reconnect. No `clearDB` / `deleteMany` boot
 * path (legacy pain).
 *
 * @module
 */

/** Package identifier for the ingest-sender skeleton. */
export const packageName = "@rawr/ingest-sender" as const;
