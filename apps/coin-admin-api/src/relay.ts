import { asc, eq, isNull } from "drizzle-orm"
import { Effect, Schedule } from "effect"
import { InvalidCoinError, parseCoinUpdated, StoreUnavailable } from "@rawr/domain"
import type { CoinUpdated } from "@rawr/domain"
import { MessagingError, reconnectSchedule } from "@rawr/messaging"
import type { MessagingService } from "@rawr/messaging"
import type { CoinOutboxRow, DbOrTx } from "./schema.js"
import { coinOutbox } from "./schema.js"

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const listUnsentOutbox = (
  db: DbOrTx,
  limit: number
): Effect.Effect<Array<CoinOutboxRow>, StoreUnavailable> =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(coinOutbox)
        .where(isNull(coinOutbox.sentAt))
        .orderBy(asc(coinOutbox.id))
        .limit(limit),
    catch: (cause) =>
      new StoreUnavailable({ message: `listUnsentOutbox: postgres unavailable (${describeCause(cause)})` })
  })

export const markOutboxSent = (
  db: DbOrTx,
  id: number
): Effect.Effect<void, StoreUnavailable> =>
  Effect.asVoid(Effect.tryPromise({
    try: () => db.update(coinOutbox).set({ sentAt: new Date() }).where(eq(coinOutbox.id, id)),
    catch: (cause) =>
      new StoreUnavailable({ message: `markOutboxSent: postgres unavailable (${describeCause(cause)})` })
  }))

// At-least-once delivery: publish first, mark sent after. A crash between the
// two leaves the row unsent, so the next poll republishes and consumers
// (sender FiberMap diffs keyed by cmcId+status) dedupe naturally.
export const relayOutboxRow = (
  db: DbOrTx,
  messaging: MessagingService,
  row: CoinOutboxRow,
  retrySchedule: Schedule.Schedule<unknown, MessagingError> = reconnectSchedule
): Effect.Effect<void, MessagingError | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const event: CoinUpdated = yield* parseCoinUpdated(row.payload)

    yield* messaging.publish(event).pipe(Effect.retry(retrySchedule))

    yield* markOutboxSent(db, row.id)
  })

export interface RelayOutboxOptions {
  readonly batchSize?: number | undefined
  readonly retrySchedule?: Schedule.Schedule<unknown, MessagingError> | undefined
}

export const relayOutboxOnce = (
  db: DbOrTx,
  messaging: MessagingService,
  options?: RelayOutboxOptions | undefined
): Effect.Effect<void, MessagingError | StoreUnavailable | InvalidCoinError> =>
  Effect.gen(function*() {
    const rows = yield* listUnsentOutbox(db, options?.batchSize ?? 100)

    yield* Effect.forEach(rows, (row) => relayOutboxRow(db, messaging, row, options?.retrySchedule ?? reconnectSchedule), {
      discard: true
    })
  })
