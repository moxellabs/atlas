import { planContext } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import {
	jsonOutputSchema,
	type PlanContextToolInput,
	planContextInputSchema,
} from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const PLAN_CONTEXT_TOOL = "plan_context";

/** Executes token-budgeted context planning for an MCP caller. */
export function executePlanContext(
	input: PlanContextToolInput,
	dependencies: AtlasMcpDependencies,
): McpJsonObject {
	const parsed = planContextInputSchema.parse(input);
	return planContext({
		db: dependencies.db,
		query: parsed.query,
		budgetTokens: parsed.budgetTokens,
		...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
		...(parsed.candidateLimit === undefined
			? {}
			: { candidateLimit: parsed.candidateLimit }),
		...(parsed.summaryLimit === undefined
			? {}
			: { summaryLimit: parsed.summaryLimit }),
		...(parsed.expansionLimit === undefined
			? {}
			: { expansionLimit: parsed.expansionLimit }),
		filters: {
			...(parsed.profile === undefined ? {} : { profile: parsed.profile }),
			...(parsed.audience === undefined ? {} : { audience: parsed.audience }),
			...(parsed.purpose === undefined ? {} : { purpose: parsed.purpose }),
			...(parsed.visibility === undefined
				? {}
				: { visibility: parsed.visibility }),
		},
	}) as unknown as McpJsonObject;
}

/** Registers the plan_context MCP tool. */
export function registerPlanContextTool(
	server: McpServer,
	dependencies: AtlasMcpDependencies,
): void {
	server.registerTool(
		PLAN_CONTEXT_TOOL,
		{
			title: "Plan ATLAS context",
			description: "Build a staged, token-budgeted context plan for a query.",
			inputSchema: planContextInputSchema,
			outputSchema: jsonOutputSchema,
		},
		(input) => toolResult(executePlanContext(input, dependencies)),
	);
}
