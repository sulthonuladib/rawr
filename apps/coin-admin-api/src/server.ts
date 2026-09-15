import * as Http from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import { Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { db } from "./db.js"
import { RoutesLive } from "./routes.js"
import { CoinAdmin } from "./service.js"

// Production HTTP composition: routes + CoinAdmin service on a Node server.
// The relay loop stays out of the request path; wire relayOutboxOnce on the
// messaging Schedule where the process runs (see relay.ts).
export const AdminApiLive = (port: number) =>
  Layer.provide(
    HttpRouter.serve(RoutesLive),
    Layer.mergeAll(CoinAdmin.layer(db), NodeHttpServer.layer(() => Http.createServer(), { port }))
  )
