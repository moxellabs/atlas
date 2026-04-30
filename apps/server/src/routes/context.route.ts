import { Elysia } from "elysia";

import { docs } from "../openapi/route-docs";
import { presentContextPlan } from "../presenters/context.presenter";
import { ok, requestIdFrom } from "../response";
import { planContextBodySchema } from "../schemas/context.schema";
import type { AtlasServerDependencies } from "../services/types";
import { parseJsonBody } from "./route-utils";

/** Context planning routes. */
export function createContextRoutes(dependencies: AtlasServerDependencies) {
	return new Elysia({ name: "atlas-context-routes" }).post(
		"/api/context/plan",
		async ({ request }) => {
			const body = await parseJsonBody(
				request,
				planContextBodySchema,
				"planContext",
			);
			return ok(
				requestIdFrom(request),
				presentContextPlan(
					dependencies.retrieval.planContext(compactPlanContext(body)),
				),
			);
		},
		docs.planContext,
	);
}

function compactPlanContext(
	body: import("../schemas/context.schema").PlanContextBody,
) {
	return {
		query: body.query,
		budgetTokens: body.budgetTokens,
		...(body.repoId === undefined ? {} : { repoId: body.repoId }),
		...(body.candidateLimit === undefined
			? {}
			: { candidateLimit: body.candidateLimit }),
		...(body.summaryLimit === undefined
			? {}
			: { summaryLimit: body.summaryLimit }),
		...(body.expansionLimit === undefined
			? {}
			: { expansionLimit: body.expansionLimit }),
		...(body.profile === undefined &&
		body.audience === undefined &&
		body.purpose === undefined &&
		body.visibility === undefined
			? {}
			: {
					filters: {
						...(body.profile === undefined ? {} : { profile: body.profile }),
						...(body.audience === undefined ? {} : { audience: body.audience }),
						...(body.purpose === undefined ? {} : { purpose: body.purpose }),
						...(body.visibility === undefined
							? {}
							: { visibility: body.visibility }),
					},
				}),
	};
}
