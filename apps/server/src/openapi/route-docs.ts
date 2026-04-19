import { type ZodType, z } from "zod";

/** HTTP method tags used to group the Scalar sidebar into product areas. */
export const openApiTags = [
	{
		name: "Runtime",
		description:
			"Health, version, and runtime readiness for the local Atlas server.",
	},
	{
		name: "Repositories",
		description: "Local repository config and indexed corpus inspection.",
	},
	{
		name: "Retrieval",
		description:
			"Search, scope inference, and context planning over the local corpus.",
	},
	{
		name: "Documents",
		description:
			"Canonical document outline and section reads from indexed public artifacts.",
	},
	{
		name: "Skills",
		description:
			"Generated Atlas skill discovery and read-only skill inspection.",
	},
	{
		name: "Inspection",
		description:
			"Diagnostics for manifests, freshness, topology, and retrieval state.",
	},
	{
		name: "Operations",
		description:
			"Explicit sync and build operations backed by local indexer services.",
	},
	{
		name: "MCP",
		description:
			"Model Context Protocol Streamable HTTP bridge for local agents.",
	},
] as const;

const requestIdSchema = z
	.string()
	.describe("Caller supplied x-request-id header, or 'local' when omitted.");
const nonEmptyStringSchema = z.string().min(1);
const optionalRepoIdSchema = nonEmptyStringSchema
	.optional()
	.describe("Optional repository ID used to constrain the operation.");
const limitSchema = z.number().int().min(1).max(100);
const tokenBudgetSchema = z.number().int().min(1).max(200_000);

const errorEnvelopeSchema = z
	.object({
		ok: z.literal(false),
		requestId: requestIdSchema,
		error: z.object({
			code: z.string(),
			message: z.string(),
			details: z.unknown().optional(),
		}),
	})
	.strict();

const readinessSchema = z
	.object({
		store: z
			.object({
				dbPath: z.string(),
				schemaVersion: z.number().int(),
				repoCount: z.number().int(),
				documentCount: z.number().int(),
				chunkCount: z.number().int(),
				summaryCount: z.number().int(),
				lastMigration: z.number().int(),
				ftsEntryCount: z.number().int(),
			})
			.passthrough(),
		mcpEnabled: z.boolean(),
		uiEnabled: z.boolean(),
		openApiEnabled: z.boolean(),
	})
	.strict();

const healthDataSchema = z
	.object({
		ok: z.literal(true),
		service: z.string(),
		version: z.string(),
		readiness: readinessSchema,
	})
	.strict();

const versionDataSchema = z
	.object({ service: z.string(), version: z.string() })
	.strict();
const repoListItemSchema = z
	.object({
		repoId: z.string(),
		mode: z.string(),
		revision: z.string().nullable().optional(),
		indexedRevision: z.string().nullable().optional(),
		fresh: z.boolean(),
	})
	.passthrough();
const repoDetailSchema = z
	.object({
		repo: z.unknown(),
		counts: z.record(z.string(), z.number()).optional(),
	})
	.passthrough();
const repoConfigSchema = z
	.unknown()
	.describe(
		"Full AtlasRepoConfig object. Mutating routes rewrite the local atlas config file atomically.",
	);
const retrievalClassificationSchema = z
	.object({
		query: z.string(),
		kind: z.string(),
		confidence: z.string(),
		score: z.number(),
		rationale: z.array(z.string()),
		signals: z.array(z.string()),
	})
	.passthrough();
const scopeResultSchema = z
	.object({
		classification: retrievalClassificationSchema,
		scopes: z.array(z.unknown()),
		diagnostics: z.array(z.unknown()),
	})
	.passthrough();
const searchResultSchema = z
	.object({
		classification: retrievalClassificationSchema,
		hits: z.array(z.unknown()),
		ambiguity: z.unknown().optional(),
		diagnostics: z.array(z.unknown()),
	})
	.passthrough();
const contextPlanSchema = z
	.object({
		classification: retrievalClassificationSchema,
		scopes: z.array(z.unknown()),
		budgetTokens: z.number().int(),
		usedTokens: z.number().int(),
		selected: z.array(z.unknown()),
		omitted: z.array(z.unknown()),
		confidence: z.string(),
		warnings: z.array(z.string()),
	})
	.passthrough();
const skillDetailSchema = z
	.object({
		skill: z.unknown(),
		sourceDocument: z.unknown().nullable().optional(),
	})
	.passthrough();
const documentOutlineSchema = z
	.object({
		document: z.unknown(),
		outline: z.array(
			z
				.object({
					sectionId: z.string(),
					headingPath: z.array(z.string()),
					ordinal: z.number().int(),
					preview: z.string(),
				})
				.strict(),
		),
		summaries: z.array(z.unknown()),
	})
	.passthrough();
const documentSectionSchema = z
	.object({
		section: z.unknown(),
		provenance: z.unknown(),
	})
	.passthrough();
const manifestInspectionSchema = z
	.object({
		diagnostics: z.unknown(),
		manifests: z.array(z.unknown()),
	})
	.passthrough();
const repoIdParam = pathParam(
	"repoId",
	"Repository ID from atlas.config. Example: github.com/org/repo.",
);
const docIdParam = pathParam(
	"docId",
	"Canonical ATLAS document ID. Example: docs/runtime-surfaces.md.",
);
const sectionIdParam = pathParam(
	"sectionId",
	"Canonical ATLAS section ID from an indexed public artifact.",
);
const skillIdParam = pathParam(
	"skillId",
	"Generated ATLAS skill ID. Example: document-codebase.",
);

/** Route details for all documented server endpoints. */
export const docs = {
	rootRedirect: {
		detail: {
			hide: true,
		},
	},
	health: operation({
		tags: ["Runtime"],
		operationId: "getHealth",
		summary: "Check server health",
		description:
			"Returns local server readiness, store diagnostics, and enabled runtime surfaces so local tools can confirm the loopback Atlas server is ready before issuing retrieval or mutation calls.",
		responses: okResponses(healthDataSchema),
	}),
	version: operation({
		tags: ["Runtime"],
		operationId: "getVersion",
		summary: "Get server version",
		description:
			"Returns the ATLAS service name and server package version for local diagnostics, generated clients, and compatibility checks.",
		responses: okResponses(versionDataSchema),
	}),
	listRepos: operation({
		tags: ["Repositories"],
		operationId: "listRepositories",
		summary: "List indexed repositories",
		description:
			"Lists repositories currently present in the local ATLAS store with freshness metadata, using only registry and corpus state already available on this machine.",
		responses: okResponses(z.array(repoListItemSchema)),
	}),
	getRepo: operation({
		tags: ["Repositories"],
		operationId: "getRepository",
		summary: "Inspect one repository",
		description:
			"Returns repository metadata, packages, modules, documents, skills, and aggregate counts for one local repository such as github.com/org/repo without fetching remote source.",
		parameters: [repoIdParam],
		responses: okResponses(repoDetailSchema, { 404: notFoundResponse() }),
	}),
	createRepo: operation({
		tags: ["Repositories"],
		operationId: "createRepository",
		summary: "Register repository config",
		description:
			"Adds one repository to the local ATLAS config file. This mutation route is intended for loopback/local development use and should reference a safe repo ID such as github.com/org/repo.",
		requestBody: jsonRequest(
			repoConfigSchema,
			"Repository config to register.",
		),
		responses: okResponses(repoConfigSchema, { 403: forbiddenResponse() }),
	}),
	replaceRepo: operation({
		tags: ["Repositories"],
		operationId: "replaceRepository",
		summary: "Replace repository config",
		description:
			"Replaces one configured repository and refreshes config-bound runtime services without restarting the server. Use from trusted loopback clients because it mutates local config state.",
		parameters: [repoIdParam],
		requestBody: jsonRequest(
			repoConfigSchema,
			"Replacement repository config. Body repoId must match the path repoId.",
		),
		responses: okResponses(repoConfigSchema, {
			403: forbiddenResponse(),
			404: notFoundResponse(),
		}),
	}),
	deleteRepo: operation({
		tags: ["Repositories"],
		operationId: "deleteRepository",
		summary: "Delete repository config",
		description:
			"Removes one repository from the local ATLAS config file. Indexed store rows and caches are not deleted, so local corpus inspection remains safe after config cleanup.",
		parameters: [repoIdParam],
		responses: okResponses(
			z.object({ repoId: z.string(), deleted: z.boolean() }).strict(),
			{ 403: forbiddenResponse(), 404: notFoundResponse() },
		),
	}),
	findScopes: operation({
		tags: ["Retrieval"],
		operationId: "findScopes",
		summary: "Infer relevant scopes",
		description:
			"Classifies a natural-language query such as How does authentication work? and returns likely package/module scopes from the local corpus only.",
		requestBody: jsonRequest(
			z
				.object({
					query: nonEmptyStringSchema,
					repoId: optionalRepoIdSchema,
					limit: limitSchema.optional(),
				})
				.strict(),
			"Scope inference request. Example query: How does authentication work? Optional repoId: github.com/org/repo.",
		),
		responses: okResponses(scopeResultSchema),
	}),
	findDocs: operation({
		tags: ["Retrieval"],
		operationId: "findDocuments",
		summary: "Search indexed documents",
		description:
			"Classifies a query such as session rotation and searches local chunks/documents using optional scope and kind constraints without fetching remote source at query time.",
		requestBody: jsonRequest(
			z
				.object({
					query: nonEmptyStringSchema,
					repoId: optionalRepoIdSchema,
					scopeIds: z.array(nonEmptyStringSchema).max(20).optional(),
					kinds: z
						.array(
							z.enum([
								"repo-doc",
								"package-doc",
								"module-doc",
								"skill-doc",
								"guide-doc",
								"reference-doc",
							]),
						)
						.max(10)
						.optional(),
					limit: limitSchema.optional(),
				})
				.strict(),
			"Document search request. Example query: session rotation. Optional repoId: github.com/org/repo.",
		),
		responses: okResponses(searchResultSchema),
	}),
	planContext: operation({
		tags: ["Retrieval"],
		operationId: "planContext",
		summary: "Plan retrieval context",
		description:
			"Builds a token-budgeted context plan for a natural-language question over the local corpus, for example budgetTokens 2000 for How does authentication work?.",
		requestBody: jsonRequest(
			z
				.object({
					query: nonEmptyStringSchema,
					repoId: optionalRepoIdSchema,
					budgetTokens: tokenBudgetSchema.default(2_000),
					candidateLimit: limitSchema.optional(),
					summaryLimit: limitSchema.optional(),
					expansionLimit: limitSchema.optional(),
				})
				.strict(),
			"Context planning request. Example budgetTokens: 2000. Example query: How does authentication work?.",
		),
		responses: okResponses(contextPlanSchema),
	}),
	readDocumentOutline: operation({
		tags: ["Documents"],
		operationId: "readDocumentOutline",
		summary: "Read document outline",
		description:
			"Returns canonical document metadata, ordered section previews, and document summaries for an indexed public artifact such as docs/runtime-surfaces.md.",
		parameters: [docIdParam],
		responses: okResponses(documentOutlineSchema, { 404: notFoundResponse() }),
	}),
	readDocumentSectionById: operation({
		tags: ["Documents"],
		operationId: "readDocumentSectionById",
		summary: "Read section by ID",
		description:
			"Returns exact canonical section text, code blocks, and provenance for a stable section ID from indexed local public artifact content.",
		parameters: [docIdParam, sectionIdParam],
		responses: okResponses(documentSectionSchema, { 404: notFoundResponse() }),
	}),
	readDocumentSectionByHeading: operation({
		tags: ["Documents"],
		operationId: "readDocumentSectionByHeading",
		summary: "Read section by heading path",
		description:
			"Returns exact canonical section text, code blocks, and provenance for an exact heading path, useful when a client knows document structure but not section IDs.",
		parameters: [
			docIdParam,
			queryParam(
				"heading",
				"Repeated heading path segment. Example: ?heading=Session&heading=Rotation.",
				schema(nonEmptyStringSchema),
				true,
			),
		],
		responses: okResponses(documentSectionSchema, { 404: notFoundResponse() }),
	}),
	listSkills: operation({
		tags: ["Skills"],
		operationId: "listSkills",
		summary: "List generated skills",
		description:
			"Lists generated ATLAS skills, optionally constrained by repository, package, module, and limit for read-only local skill discovery such as document-codebase.",
		parameters: [
			queryParam("repoId", "Optional repository ID."),
			queryParam("packageId", "Optional package ID."),
			queryParam("moduleId", "Optional module ID."),
			queryParam(
				"limit",
				"Maximum number of skills to return.",
				schema(limitSchema),
			),
		],
		responses: okResponses(z.array(z.unknown())),
	}),
	getSkill: operation({
		tags: ["Skills"],
		operationId: "getSkill",
		summary: "Get one generated skill",
		description:
			"Returns a generated skill such as document-codebase plus its source canonical document when available, using local indexed skill artifacts only.",
		parameters: [skillIdParam],
		responses: okResponses(skillDetailSchema, { 404: notFoundResponse() }),
	}),
	inspectManifest: operation({
		tags: ["Inspection"],
		operationId: "inspectManifest",
		summary: "Inspect manifest state",
		description:
			"Returns manifest rows and store diagnostics for local indexed repositories. This OpenAPI surface plus CLI inspect/list commands is the supported local inspector UI for now.",
		responses: okResponses(manifestInspectionSchema),
	}),
	inspectFreshness: operation({
		tags: ["Inspection"],
		operationId: "inspectFreshness",
		summary: "Inspect repository freshness",
		description:
			"Compares indexed revisions against current repository state known to the store so local tooling can warn about stale artifacts before retrieval.",
		responses: okResponses(z.array(z.unknown())),
	}),
	inspectTopology: operation({
		tags: ["Inspection"],
		operationId: "inspectTopology",
		summary: "Inspect compiled topology",
		description:
			"Returns package/module/document topology for one indexed repository such as github.com/org/repo from local store state only.",
		parameters: [repoIdParam],
		responses: okResponses(repoDetailSchema, { 404: notFoundResponse() }),
	}),
	inspectRetrieval: operation({
		tags: ["Inspection"],
		operationId: "inspectRetrieval",
		summary: "Inspect retrieval diagnostics",
		description:
			"Runs retrieval with diagnostics for local debugging and ranking inspection, for example query session rotation with budgetTokens 2000.",
		parameters: [
			queryParam(
				"query",
				"Natural-language query.",
				schema(nonEmptyStringSchema),
				true,
			),
			queryParam("repoId", "Optional repository ID."),
			queryParam(
				"budgetTokens",
				"Maximum token budget for inspection.",
				schema(tokenBudgetSchema),
			),
		],
		responses: okResponses(z.unknown()),
	}),
	sync: operation({
		tags: ["Operations"],
		operationId: "requestSync",
		summary: "Request repository sync",
		description:
			"Synchronizes one repository or all configured repositories and returns structured source-update reports. Use incremental for normal local maintenance and trusted loopback callers only.",
		requestBody: jsonRequest(
			z
				.object({
					repoId: optionalRepoIdSchema,
					mode: z.enum(["incremental", "full"]).optional(),
					dryRun: z.boolean().optional(),
				})
				.strict(),
			"Sync request. Example repoId: github.com/org/repo. Example mode: incremental.",
		),
		responses: okResponses(z.unknown(), { 400: validationResponse() }),
	}),
	build: operation({
		tags: ["Operations"],
		operationId: "requestBuild",
		summary: "Request artifact build",
		description:
			"Builds one repository or all configured repositories, supporting full, incremental, and targeted partial rebuilds of local Atlas artifacts for trusted loopback callers.",
		requestBody: jsonRequest(
			z
				.object({
					repoId: optionalRepoIdSchema,
					mode: z.enum(["incremental", "full"]).optional(),
					force: z.boolean().optional(),
					docIds: z.array(nonEmptyStringSchema).optional(),
					packageId: nonEmptyStringSchema.optional(),
					moduleId: nonEmptyStringSchema.optional(),
				})
				.strict(),
			"Build request. Example repoId: github.com/org/repo. Example mode: incremental. Example docIds entry: docs/runtime-surfaces.md.",
		),
		responses: okResponses(z.unknown(), { 400: validationResponse() }),
	}),
	mcpGet: mcpOperation(
		"getMcpSession",
		"Open MCP stream",
		"Opens the MCP Streamable HTTP server-to-client stream for local agents when supported by the client runtime.",
	),
	mcpPost: mcpOperation(
		"postMcpMessage",
		"Send MCP message",
		"Sends a JSON-RPC MCP message to the local Streamable HTTP transport without changing HTTP API route contracts.",
	),
	mcpDelete: mcpOperation(
		"deleteMcpSession",
		"Close MCP session",
		"Closes a local MCP Streamable HTTP session when supported by the client, allowing agents to release loopback resources.",
	),
} as const;

function operation(detail: Record<string, unknown>) {
	return { detail };
}

function mcpOperation(
	operationId: string,
	summary: string,
	description: string,
) {
	return operation({
		tags: ["MCP"],
		operationId,
		summary,
		description,
		responses: {
			200: {
				description:
					"MCP Streamable HTTP response. Body and content type are defined by the MCP protocol exchange.",
			},
			400: validationResponse(),
			500: jsonResponse(errorEnvelopeSchema, "MCP bridge failure."),
		},
	});
}

function successEnvelope<T extends ZodType>(data: T) {
	return z
		.object({ ok: z.literal(true), requestId: requestIdSchema, data })
		.strict();
}

function okResponses<T extends ZodType>(
	data: T,
	extra: Record<number, unknown> = {},
) {
	return {
		200: jsonResponse(successEnvelope(data), "Successful ATLAS response."),
		400: validationResponse(),
		500: jsonResponse(errorEnvelopeSchema, "Unexpected server error."),
		...extra,
	};
}

function validationResponse() {
	return jsonResponse(errorEnvelopeSchema, "Request validation failed.");
}

function notFoundResponse() {
	return jsonResponse(errorEnvelopeSchema, "Requested resource was not found.");
}

function forbiddenResponse() {
	return jsonResponse(
		errorEnvelopeSchema,
		"Operation is not allowed for the current local server binding.",
	);
}

function jsonRequest(bodySchema: ZodType, description: string) {
	return {
		description,
		required: true,
		content: {
			"application/json": {
				schema: schema(bodySchema),
			},
		},
	};
}

function jsonResponse(bodySchema: ZodType, description: string) {
	return {
		description,
		content: {
			"application/json": {
				schema: schema(bodySchema),
			},
		},
	};
}

function pathParam(name: string, description: string) {
	return {
		name,
		in: "path",
		required: true,
		description,
		schema: schema(nonEmptyStringSchema),
	};
}

function queryParam(
	name: string,
	description: string,
	paramSchema = schema(nonEmptyStringSchema),
	required = false,
) {
	return { name, in: "query", required, description, schema: paramSchema };
}

function schema(zodSchema: ZodType): Record<string, unknown> {
	return z.toJSONSchema(zodSchema) as Record<string, unknown>;
}
