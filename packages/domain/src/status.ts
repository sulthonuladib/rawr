import { Schema } from "effect"
import { CmcId } from "./brands.js"

export class CoinActive extends Schema.TaggedClass<CoinActive>()("Active", {
  cmcId: CmcId
}) {}

export class CoinInactive extends Schema.TaggedClass<CoinInactive>()("Inactive", {
  cmcId: CmcId,
  reason: Schema.String
}) {}

export const CoinStatus = Schema.Union([CoinActive, CoinInactive])

export type CoinStatus = typeof CoinStatus["Type"]

export type CoinStatusEncoded = typeof CoinStatus["Encoded"]
