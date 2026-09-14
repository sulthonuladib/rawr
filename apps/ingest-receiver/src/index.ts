export const packageName = "@rawr/ingest-receiver" as const

export { exchangeSnapshots, schema } from "./schema.js"

export type { Db, ExchangeSnapshotInsert, ExchangeSnapshotRow } from "./schema.js"

export { saveSnapshot } from "./snapshots.js"
