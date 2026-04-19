import { Elysia } from "elysia";

import { docs } from "../openapi/route-docs";
import { ok, requestIdFrom } from "../response";
import { buildBodySchema } from "../schemas/sync.schema";
import type { AtlasServerDependencies } from "../services/types";
import { parseJsonBody, routeError } from "./route-utils";

/** Build route backed by the shared indexer orchestration package. */
export function createBuildRoutes(dependencies: AtlasServerDependencies) {
  return new Elysia({ name: "atlas-build-routes" }).post(
    "/api/build",
    async ({ request, set }) => {
      try {
        const body = await parseJsonBody(request, buildBodySchema, "build");
        return ok(requestIdFrom(request), await dependencies.operations.build(body));
      } catch (error) {
        return routeError(error, request, set);
      }
    },
    docs.build
  );
}
