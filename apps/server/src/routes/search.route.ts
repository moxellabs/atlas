import { Elysia } from "elysia";

import { docs } from "../openapi/route-docs";
import { presentScopes, presentSearch } from "../presenters/search.presenter";
import { ok, requestIdFrom } from "../response";
import {
	findDocsBodySchema,
	findScopesBodySchema,
} from "../schemas/search.schema";
import type { AtlasServerDependencies } from "../services/types";
import { parseJsonBody, routeError } from "./route-utils";

/** Search and scope inference routes. */
export function createSearchRoutes(dependencies: AtlasServerDependencies) {
	return new Elysia({ name: "atlas-search-routes" })
		.post(
			"/api/search/scopes",
			async ({ request, set }) => {
				try {
					const body = await parseJsonBody(
						request,
						findScopesBodySchema,
						"findScopes",
					);
					return ok(
						requestIdFrom(request),
						presentScopes(
							dependencies.retrieval.findScopes(compactFindScopes(body)),
						),
					);
				} catch (error) {
					return routeError(error, request, set);
				}
			},
			docs.findScopes,
		)
		.post(
			"/api/search/docs",
			async ({ request, set }) => {
				try {
					const body = await parseJsonBody(
						request,
						findDocsBodySchema,
						"findDocs",
					);
					return ok(
						requestIdFrom(request),
						presentSearch(
							dependencies.retrieval.findDocs(compactFindDocs(body)),
						),
					);
				} catch (error) {
					return routeError(error, request, set);
				}
			},
			docs.findDocs,
		);
}

function compactMetadataFilters(
	body: import("../schemas/search.schema").FindDocsBody,
) {
	const filters = {
		...(body.profile === undefined ? {} : { profile: body.profile }),
		...(body.audience === undefined ? {} : { audience: body.audience }),
		...(body.purpose === undefined ? {} : { purpose: body.purpose }),
		...(body.visibility === undefined ? {} : { visibility: body.visibility }),
	};
	return Object.keys(filters).length === 0 ? {} : { filters };
}

function compactFindScopes(
	body: import("../schemas/search.schema").FindScopesBody,
) {
	return {
		query: body.query,
		...(body.repoId === undefined ? {} : { repoId: body.repoId }),
		...(body.limit === undefined ? {} : { limit: body.limit }),
		...compactMetadataFilters(body),
	};
}

function compactFindDocs(
	body: import("../schemas/search.schema").FindDocsBody,
) {
	return {
		query: body.query,
		...(body.repoId === undefined ? {} : { repoId: body.repoId }),
		...(body.scopeIds === undefined ? {} : { scopeIds: body.scopeIds }),
		...(body.kinds === undefined ? {} : { kinds: body.kinds }),
		...(body.limit === undefined ? {} : { limit: body.limit }),
		...compactMetadataFilters(body),
	};
}
