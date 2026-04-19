import { Elysia } from "elysia";

import { docs } from "../openapi/route-docs";
import { ok, requestIdFrom } from "../response";
import { presentFreshness, presentStoreDiagnostics, presentRepoDetail } from "../presenters/repo.presenter";
import { repoIdParamSchema } from "../schemas/common.schema";
import { inspectRetrievalQuerySchema } from "../schemas/repo.schema";
import type { AtlasServerDependencies } from "../services/types";
import { parseParams, parseQuery } from "./route-utils";

/** Local engineer inspection routes. */
export function createInspectRoutes(dependencies: AtlasServerDependencies) {
  return new Elysia({ name: "atlas-inspect-routes" })
    .get(
      "/api/inspect/manifest",
      ({ request }) =>
        ok(requestIdFrom(request), {
          diagnostics: presentStoreDiagnostics(dependencies.store.diagnostics()),
          manifests: dependencies.store.listManifests()
        }),
      docs.inspectManifest
    )
    .get(
      "/api/inspect/freshness",
      ({ request }) => ok(requestIdFrom(request), presentFreshness(dependencies.store.listFreshness())),
      docs.inspectFreshness
    )
    .get(
      "/api/inspect/topology/:repoId",
      ({ params, request }) => {
        const { repoId } = parseParams(params, repoIdParamSchema, "inspectTopology");
        return ok(requestIdFrom(request), presentRepoDetail(dependencies.store.getRepoDetail(repoId)));
      },
      docs.inspectTopology
    )
    .get(
      "/api/inspect/retrieval",
      ({ query, request }) => {
        const parsed = parseQuery(query, inspectRetrievalQuerySchema, "inspectRetrieval");
        return ok(requestIdFrom(request), dependencies.retrieval.inspect(compactInspect(parsed)));
      },
      docs.inspectRetrieval
    );
}

function compactInspect(query: import("../schemas/repo.schema").InspectRetrievalQuery) {
  return {
    query: query.query,
    budgetTokens: query.budgetTokens,
    ...(query.repoId === undefined ? {} : { repoId: query.repoId })
  };
}
