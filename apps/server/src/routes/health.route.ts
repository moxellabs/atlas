import { Elysia } from "elysia";

import { APP_NAME, VERSION } from "../constants";
import { docs } from "../openapi/route-docs";
import { ok, requestIdFrom } from "../response";
import type { AtlasServerDependencies } from "../services/types";

/** Health and version routes. */
export function createHealthRoutes(dependencies: AtlasServerDependencies) {
  return new Elysia({ name: "atlas-health-routes" })
    .get(
      "/health",
      ({ request }) =>
        ok(requestIdFrom(request), {
          ok: true,
          service: APP_NAME,
          version: VERSION,
          readiness: {
            store: dependencies.store.diagnostics(),
            mcpEnabled: dependencies.env.enableMcp,
            uiEnabled: dependencies.env.enableUi,
            openApiEnabled: dependencies.env.enableOpenApi
          }
        }),
      docs.health
    )
    .get(
      "/version",
      ({ request }) =>
        ok(requestIdFrom(request), {
          service: APP_NAME,
          version: VERSION
        }),
      docs.version
    );
}
