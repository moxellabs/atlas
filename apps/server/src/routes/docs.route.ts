import { Elysia } from "elysia";

import { docIdParamSchema, sectionIdParamSchema } from "../schemas/common.schema";
import { readSectionByHeadingQuerySchema } from "../schemas/docs.schema";
import { docs } from "../openapi/route-docs";
import { ok, requestIdFrom } from "../response";
import type { AtlasServerDependencies } from "../services/types";
import { parseParams, parseQuery, routeError } from "./route-utils";

/** Direct document and section read routes for local inspection. */
export function createDocsRoutes(dependencies: AtlasServerDependencies) {
  return new Elysia({ name: "atlas-docs-routes" })
    .get(
      "/api/docs/:docId/outline",
      ({ params, request, set }) => {
        try {
          const { docId } = parseParams(params, docIdParamSchema, "readDocumentOutline");
          return ok(requestIdFrom(request), dependencies.store.getDocumentOutline(docId));
        } catch (error) {
          return routeError(error, request, set);
        }
      },
      docs.readDocumentOutline
    )
    .get(
      "/api/docs/:docId/sections/:sectionId",
      ({ params, request, set }) => {
        try {
          const { docId, sectionId } = parseParams(params, sectionIdParamSchema, "readDocumentSectionById");
          return ok(requestIdFrom(request), dependencies.store.getDocumentSection(docId, { sectionId }));
        } catch (error) {
          return routeError(error, request, set);
        }
      },
      docs.readDocumentSectionById
    )
    .get(
      "/api/docs/:docId/section",
      ({ params, request, set }) => {
        try {
          const { docId } = parseParams(params, docIdParamSchema, "readDocumentSectionByHeading");
          const parsed = parseQuery({ heading: new URL(request.url).searchParams.getAll("heading") }, readSectionByHeadingQuerySchema, "readDocumentSectionByHeading");
          return ok(requestIdFrom(request), dependencies.store.getDocumentSection(docId, { heading: parsed.heading }));
        } catch (error) {
          return routeError(error, request, set);
        }
      },
      docs.readDocumentSectionByHeading
    );
}
