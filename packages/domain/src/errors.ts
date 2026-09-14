import { Schema } from "effect"
import { CmcId } from "./brands.js"

export class InvalidCoinError extends Schema.TaggedError<InvalidCoinError>()("InvalidCoinError", {
  message: Schema.String
}) {}

export class CoinNotFound extends Schema.TaggedError<CoinNotFound>()("CoinNotFound", {
  cmcId: CmcId,
  message: Schema.String
}) {}

export class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()("StoreUnavailable", {
  message: Schema.String
}) {}
