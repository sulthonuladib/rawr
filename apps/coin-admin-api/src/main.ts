import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { loadCoinAdminApiConfig } from "@rawr/config"
import { AdminApiLive } from "./server.js"

// Standalone entrypoint: `pnpm start` (after `pnpm build`).
// Bind address and port come from packages/config (COIN_ADMIN_API_HOST defaults
// to 0.0.0.0, COIN_ADMIN_API_PORT to 4100) — never process.env here.
const main = Effect.gen(function*() {
  const api = yield* loadCoinAdminApiConfig

  yield* Layer.launch(AdminApiLive(api.port, api.host))
})

main.pipe(NodeRuntime.runMain)
