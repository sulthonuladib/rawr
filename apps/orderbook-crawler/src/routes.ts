import { Effect, Predicate } from "effect"
import { InvalidCoinError, slugToExchange } from "@rawr/domain"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AlreadyRunning, CrawlerError, NotImplementedExchange } from "./errors.js"
import type { BadRequest, Conflict, NotFound, NotImplemented, Unavailable } from "./api.js"
import { Api, badRequest, conflict, notFound, notImplemented } from "./api.js"
import { EligibilitySource } from "./source.js"
import { Supervisor } from "./supervisor.js"

type HandlerError = BadRequest | NotFound | Conflict | NotImplemented | Unavailable

const isHandlerError = (cause: unknown): cause is HandlerError =>
  Predicate.isTagged(cause, "BadRequest") || Predicate.isTagged(cause, "NotFound") ||
  Predicate.isTagged(cause, "Conflict") || Predicate.isTagged(cause, "NotImplemented") ||
  Predicate.isTagged(cause, "Unavailable")

const toHandlerError = (cause: unknown): HandlerError => {
  if (isHandlerError(cause)) {
    return cause
  }

  if (cause instanceof AlreadyRunning) {
    return conflict(cause.message)
  }

  if (cause instanceof NotImplementedExchange) {
    return notImplemented(cause.message)
  }

  if (cause instanceof InvalidCoinError) {
    return badRequest(cause.message)
  }

  if (cause instanceof CrawlerError) {
    return badRequest(cause.message)
  }

  if (cause instanceof Error) {
    return badRequest(cause.message)
  }

  return badRequest(String(cause))
}

const CrawlerLive = HttpApiBuilder.group(Api, "Crawler", (handlers) =>
  handlers.handleAll({
    getState: () =>
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        const snapshot = yield* supervisor.getState()

        return {
          shards: snapshot.shards.map((shard) => ({
            id: shard.id,
            exchange: shard.exchange,
            status: shard.status,
            coins: shard.coins.map((slot) => ({
              cmcId: slot.cmcId,
              symbol: slot.symbol,
              state: slot.state,
              lastError: slot.lastError
            }))
          }))
        }
      }).pipe(Effect.mapError(toHandlerError)),
    startExchange: ({ params }) =>
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        const source = yield* EligibilitySource

        const exchange = yield* slugToExchange(params.exchange).pipe(
          Effect.mapError((cause) => notFound(cause.message))
        )

        const eligible = yield* source.loadEligible(exchange).pipe(
          Effect.mapError((cause) => badRequest(cause.message))
        )

        return yield* supervisor.startExchange(exchange, eligible).pipe(
          Effect.mapError((cause) => toHandlerError(cause))
        )
      }).pipe(Effect.mapError(toHandlerError)),
    stopExchange: ({ params }) =>
      Effect.gen(function*() {
        const supervisor = yield* Supervisor

        const exchange = yield* slugToExchange(params.exchange).pipe(
          Effect.mapError((cause) => notFound(cause.message))
        )

        return yield* supervisor.stopExchange(exchange).pipe(
          Effect.mapError((cause) => toHandlerError(cause))
        )
      }).pipe(Effect.mapError(toHandlerError))
  }))

export { CrawlerLive }
