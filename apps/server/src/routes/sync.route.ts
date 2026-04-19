import { Elysia } from "elysia";

import { docs } from "../openapi/route-docs";
import { ok, requestIdFrom } from "../response";
import { syncBodySchema } from "../schemas/sync.schema";
import type { AtlasServerDependencies } from "../services/types";
import { parseJsonBody, routeError } from "./route-utils";

/** Sync route backed by the shared indexer orchestration package. */
export function createSyncRoutes(dependencies: AtlasServerDependencies) {
  return new Elysia({ name: "atlas-sync-routes" }).post(
    "/api/sync",
    async ({ request, set }) => {
      try {
        const body = await parseJsonBody(request, syncBodySchema, "sync");
        return ok(requestIdFrom(request), await dependencies.operations.sync(body));
      } catch (error) {
        return routeError(error, request, set);
      }
    },
    docs.sync
  );
}
