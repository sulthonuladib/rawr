import { asc, eq } from "drizzle-orm"
import { Effect, Schedule, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { CmcId, CoinInactive, CoinUpdated, encodeCoinUpdated, StoreUnavailable, Symbol } from "@rawr/domain"
import type { BusEvent, MessagingService } from "@rawr/messaging"
import { MessagingError } from "@rawr/messaging"
import { insertOutboxRow } from "./service.js"
import { listUnsentOutbox, relayOutboxOnce, relayOutboxRow } from "./relay.js"
import { db, pool } from "./db.js"
import { coinOutbox } from "./schema.js"
import type { CoinOutboxRow } from "./schema.js"

// Parsed (not asserted): decodeUnknownSync establishes the brands.
const firstId = Schema.decodeUnknownSync(CmcId)(925001)

const retryId = Schema.decodeUnknownSync(CmcId)(925002)

const exhaustedId = Schema.decodeUnknownSync(CmcId)(925003)

const symbol = Schema.decodeUnknownSync(Symbol)("TSTRL")

const fastSchedule = Schedule.recurs(2)

const seedRow = (cmcId: CmcId) =>
  Effect.gen(function*() {
    const event = new CoinUpdated({
      cmcId,
      symbol,
      status: new CoinInactive({ cmcId, reason: "relay test" }),
      reason: "relay test"
    })

    const payload = yield* encodeCoinUpdated(event)

    yield* insertOutboxRow(db, cmcId, payload)
  })

const readLastRow = (cmcId: CmcId): Effect.Effect<CoinOutboxRow, StoreUnavailable> =>
  Effect.gen(function*() {
    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(coinOutbox).where(eq(coinOutbox.cmcId, cmcId)).orderBy(asc(coinOutbox.id)),
      catch: () => new StoreUnavailable({ message: `readLastRow: postgres unavailable` })
    })

    const row = rows.at(-1)

    if (row === undefined) {
      return yield* Effect.fail(
        new StoreUnavailable({ message: `readLastRow: no outbox row for cmcId ${cmcId}` })
      )
    }

    return row
  })

const makeFakeMessaging = (failuresBeforeSuccess: number) => {
  let attempts = 0
  const published: Array<CoinUpdated> = []

  const service: MessagingService = {
    publish: (event: BusEvent) =>
      Effect.gen(function*() {
        attempts += 1

        if (attempts <= failuresBeforeSuccess) {
          return yield* Effect.fail(new MessagingError({ message: "broker down", operation: "publish" }))
        }

        if (event instanceof CoinUpdated) {
          published.push(event)
        }
      }),
    subscribe: () => Effect.void
  }

  return { service, published, attempts: () => attempts }
}

afterAll(async () => {
  await pool.end()
})

describe("outbox relay", () => {
  it("publishes then marks the row sent", async () => {
    const fake = makeFakeMessaging(0)

    await Effect.runPromise(seedRow(firstId))

    const unsentBefore = await Effect.runPromise(listUnsentOutbox(db, 100))

    expect(unsentBefore.map((row) => row.cmcId)).toContain(firstId)
    expect(unsentBefore.find((row) => row.cmcId === firstId)?.sentAt).toBeNull()

    await Effect.runPromise(relayOutboxOnce(db, fake.service, { batchSize: 100, retrySchedule: fastSchedule }))

    expect(fake.published.map((event) => event.cmcId)).toContain(firstId)

    const row = await Effect.runPromise(readLastRow(firstId))

    expect(row.sentAt).not.toBeNull()
  })

  it("retries publish when the broker is down", async () => {
    const fake = makeFakeMessaging(2)

    await Effect.runPromise(seedRow(retryId))

    const row = await Effect.runPromise(readLastRow(retryId))

    expect(row.sentAt).toBeNull()

    await Effect.runPromise(relayOutboxRow(db, fake.service, row, fastSchedule))

    expect(fake.attempts()).toBe(3)
    expect(fake.published.map((event) => event.cmcId)).toContain(retryId)

    const after = await Effect.runPromise(readLastRow(retryId))

    expect(after.sentAt).not.toBeNull()
  })

  it("leaves the row unsent when retries are exhausted", async () => {
    const fake = makeFakeMessaging(5)

    await Effect.runPromise(seedRow(exhaustedId))

    const row = await Effect.runPromise(readLastRow(exhaustedId))

    const error = await Effect.runPromise(Effect.flip(relayOutboxRow(db, fake.service, row, fastSchedule)))

    expect(error._tag).toBe("MessagingError")
    expect(fake.attempts()).toBe(3)

    const after = await Effect.runPromise(readLastRow(exhaustedId))

    expect(after.sentAt).toBeNull()
  })
})
