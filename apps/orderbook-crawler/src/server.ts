import * as Http from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import { Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi"
import { Api } from "./api.js"
import { CrawlerLive } from "./routes.js"
import { EligibilitySource } from "./source.js"
import { Supervisor } from "./supervisor.js"

export const ApiGroupsLive = CrawlerLive

export const ApiRouterLive = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(ApiGroupsLive),
  Layer.provide(HttpApiScalar.layer(Api))
)

export const RoutesLive = ApiRouterLive

export const CrawlerApiLive = (port: number, host = "::") =>
  Layer.provide(
    HttpRouter.serve(ApiRouterLive),
    Layer.mergeAll(
      Supervisor.layerMemory(),
      EligibilitySource.layerMemory([], []),
      NodeHttpServer.layer(() => Http.createServer(), { port, host })
    )
  )
