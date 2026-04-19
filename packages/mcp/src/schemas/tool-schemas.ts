import { z } from "zod";

/** Shared non-empty query schema. */
export const querySchema = z
	.string()
	.trim()
	.min(1)
	.describe("Natural-language query.");

/** Shared positive limit schema. */
export const limitSchema = z
	.number()
	.int()
	.min(1)
	.max(100)
	.optional()
	.describe("Maximum number of results.");

/** Shared repository identifier schema. */
export const repoIdSchema = z
	.string()
	.trim()
	.min(1)
	.optional()
	.describe("Optional repository identifier.");
const docAudienceSchema = z.enum([
	"consumer",
	"contributor",
	"maintainer",
	"internal",
]);
const docPurposeSchema = z.enum([
	"guide",
	"reference",
	"api",
	"architecture",
	"operations",
	"workflow",
	"planning",
	"implementation",
	"archive",
	"troubleshooting",
]);
const docVisibilitySchema = z.enum(["public", "internal"]);

/** Shared scope filter schema for store-backed tools. */
export const scopeFilterSchema = z
	.object({
		repoId: repoIdSchema,
		packageId: z.string().trim().min(1).optional(),
		moduleId: z.string().trim().min(1).optional(),
		skillId: z.string().trim().min(1).optional(),
	})
	.strict();

/** Input schema for find_scopes. */
export const findScopesInputSchema = z
	.object({
		query: querySchema,
		repoId: repoIdSchema,
		limit: limitSchema,
	})
	.strict();

/** Input schema for find_docs. */
export const findDocsInputSchema = z
	.object({
		query: querySchema,
		repoId: repoIdSchema,
		scopeIds: z.array(z.string().trim().min(1)).max(20).optional(),
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
		profile: z.string().trim().min(1).optional(),
		audience: z.array(docAudienceSchema).optional(),
		purpose: z.array(docPurposeSchema).optional(),
		visibility: z.array(docVisibilitySchema).optional(),
		limit: limitSchema,
	})
	.strict();

/** Input schema for read_outline. */
export const readOutlineInputSchema = z
	.object({ docId: z.string().trim().min(1) })
	.strict();

/** Input schema for read_section. */
export const readSectionInputSchema = z
	.object({
		docId: z.string().trim().min(1),
		sectionId: z.string().trim().min(1).optional(),
		heading: z.array(z.string().trim().min(1)).optional(),
	})
	.strict()
	.refine(
		(value) => value.sectionId !== undefined || value.heading !== undefined,
		{
			message: "Either sectionId or heading is required.",
		},
	);

/** Input schema for list_skills. */
export const listSkillsInputSchema = scopeFilterSchema
	.extend({ limit: limitSchema })
	.strict();

/** Input schema for get_skill. */
export const getSkillInputSchema = z
	.object({ skillId: z.string().trim().min(1) })
	.strict();

/** Input schema for use_skill. */
export const useSkillInputSchema = z
	.object({
		nameOrAlias: z.string().trim().min(1),
		repoId: repoIdSchema,
		task: z.string().trim().min(1).optional(),
		agent: z.string().trim().min(1).optional(),
	})
	.strict();

/** Input schema for expand_related. */
export const expandRelatedInputSchema = z
	.object({
		targetType: z.enum(["document", "section", "chunk", "skill", "summary"]),
		targetId: z.string().trim().min(1),
		limit: limitSchema,
	})
	.strict();

/** Input schema for explain_module. */
export const explainModuleInputSchema = z
	.object({
		moduleId: z.string().trim().min(1),
		limit: limitSchema,
	})
	.strict();

/** Input schema for get_freshness. */
export const getFreshnessInputSchema = z
	.object({
		repoId: repoIdSchema,
	})
	.strict();

/** Input schema for plan_context. */
export const planContextInputSchema = z
	.object({
		query: querySchema,
		repoId: repoIdSchema,
		budgetTokens: z.number().int().min(1).max(200_000).default(2_000),
		candidateLimit: limitSchema,
		summaryLimit: limitSchema,
		expansionLimit: limitSchema,
		profile: z.string().trim().min(1).optional(),
		audience: z.array(docAudienceSchema).optional(),
		purpose: z.array(docPurposeSchema).optional(),
		visibility: z.array(docVisibilitySchema).optional(),
	})
	.strict();

/** Input schema for what_changed. */
export const whatChangedInputSchema = z
	.object({
		repoId: z.string().trim().min(1),
		fromRevision: z.string().trim().min(1).optional(),
		toRevision: z.string().trim().min(1).optional(),
	})
	.strict();

/** Loose object output schema used by SDK registration while contract tests assert exact shapes. */
export const jsonOutputSchema = z.object({}).passthrough();

export type FindScopesInput = z.infer<typeof findScopesInputSchema>;
export type FindDocsInput = z.infer<typeof findDocsInputSchema>;
export type ReadOutlineInput = z.infer<typeof readOutlineInputSchema>;
export type ReadSectionInput = z.infer<typeof readSectionInputSchema>;
export type ListSkillsInput = z.infer<typeof listSkillsInputSchema>;
export type GetSkillInput = z.infer<typeof getSkillInputSchema>;
export type UseSkillInput = z.infer<typeof useSkillInputSchema>;
export type ExpandRelatedInput = z.infer<typeof expandRelatedInputSchema>;
export type ExplainModuleInput = z.infer<typeof explainModuleInputSchema>;
export type GetFreshnessInput = z.infer<typeof getFreshnessInputSchema>;
export type PlanContextToolInput = z.infer<typeof planContextInputSchema>;
export type WhatChangedInput = z.infer<typeof whatChangedInputSchema>;
