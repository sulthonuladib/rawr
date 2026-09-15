import * as Http from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import { Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { db } from "./db.js"
import { ApiRouterLive } from "./routes.js"
import { CoinAdmin } from "./service.js"

// Production HTTP composition: HttpApi routes (+ /docs Scalar UI and
// /openapi.json) with the CoinAdmin service on a Node server.
// The relay loop stays out of the request path; wire relayOutboxOnce on the
// messaging Schedule where the process runs (see relay.ts).
// The host defaults to IPv6-any (Node's dual-stack default, matching the
// previous port-only behavior); pass "0.0.0.0" to bind IPv4-any explicitly.
export const AdminApiLive = (port: number, host = "::") =>
  Layer.provide(
    HttpRouter.serve(ApiRouterLive),
    Layer.mergeAll(
      CoinAdmin.layer(db),
      NodeHttpServer.layer(() => Http.createServer(), { port, host })
    )
  )
