import { planContext } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import {
	type FindDocsInput,
	findDocsInputSchema,
	jsonOutputSchema,
} from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const FIND_DOCS_TOOL = "find_docs";

/** Executes document-oriented ranked retrieval for an MCP caller. */
export function executeFindDocs(
	input: FindDocsInput,
	dependencies: AtlasMcpDependencies,
): McpJsonObject {
	const parsed = findDocsInputSchema.parse(input);
	const plan = planContext({
		db: dependencies.db,
		query: parsed.query,
		budgetTokens: 8_000,
		...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
		candidateLimit: parsed.limit ?? 20,
		filters: {
			...(parsed.profile === undefined ? {} : { profile: parsed.profile }),
			...(parsed.audience === undefined ? {} : { audience: parsed.audience }),
			...(parsed.purpose === undefined ? {} : { purpose: parsed.purpose }),
			...(parsed.visibility === undefined
				? {}
				: { visibility: parsed.visibility }),
		},
	});
	const scopeIds = new Set(parsed.scopeIds ?? []);
	const kinds = new Set(parsed.kinds ?? []);
	const hits = plan.rankedHits
		.filter(
			(hit) =>
				hit.targetType !== "summary" &&
				(kinds.size === 0 || (hit.kind !== undefined && kinds.has(hit.kind))),
		)
		.filter((hit) => {
			if (scopeIds.size === 0) {
				return true;
			}
			return [
				hit.provenance.repoId,
				hit.provenance.packageId,
				hit.provenance.moduleId,
				hit.provenance.skillId,
			].some((scopeId) => scopeId !== undefined && scopeIds.has(scopeId));
		})
		.slice(0, parsed.limit ?? 20);
	return {
		query: parsed.query,
		classification: plan.classification,
		hits,
		filters: plan.diagnostics.find(
			(diagnostic) => diagnostic.stage === "candidate-generation",
		)?.metadata?.filters,
		ambiguity: plan.ambiguity,
		diagnostics: plan.diagnostics,
	};
}

/** Registers the find_docs MCP tool. */
export function registerFindDocsTool(
	server: McpServer,
	dependencies: AtlasMcpDependencies,
): void {
	server.registerTool(
		FIND_DOCS_TOOL,
		{
			title: "Find ATLAS docs",
			description:
				"Return ranked document, section, chunk, or skill hits for a query.",
			inputSchema: findDocsInputSchema,
			outputSchema: jsonOutputSchema,
		},
		(input) => toolResult(executeFindDocs(input, dependencies)),
	);
}
