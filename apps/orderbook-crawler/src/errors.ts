import { Schema } from "effect"

export class CrawlerError extends Schema.TaggedError<CrawlerError>()("CrawlerError", {
  message: Schema.String,
  reason: Schema.optional(Schema.String)
}) {}

export class AlreadyRunning extends Schema.TaggedError<AlreadyRunning>()("AlreadyRunning", {
  exchange: Schema.String,
  message: Schema.String
}) {}

export class NotImplementedExchange extends Schema.TaggedError<NotImplementedExchange>()(
  "NotImplementedExchange",
  {
    exchange: Schema.String,
    message: Schema.String
  }
) {}

export class UnknownExchange extends Schema.TaggedError<UnknownExchange>()("UnknownExchange", {
  exchange: Schema.String,
  message: Schema.String
}) {}
