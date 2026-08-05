import { z } from "zod";

/** Shared non-empty query schema. */
export const querySchema = z
  .string()
  .trim()
  .min(1)
  .describe(
    "Natural-language query. For an exact lookup, pass the user's complete question rather than a shortened topic label. Preserve named entities, paths, requested stages, and constraints.",
  );

/** Shared positive limit schema. */
export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Maximum number of results.");

const selectionLimitSchema = z
  .number()
  .int()
  .min(0)
  .max(100)
  .optional()
  .describe("Maximum selected items; zero disables this selection stage.");

/** Shared repository identifier schema. */
export const repoIdSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    "Optional repository identifier such as github.com/owner/repo; pass it when the corpus has multiple repos.",
  );
const profileSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    "Optional metadata filter. Omit unless the user explicitly requests a profile or audience. Use public for consumer docs, contributor for public contributor docs, maintainer for maintainer docs, or internal for all indexed docs.",
  );
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

/** Input schema for find_scopes. */
export const findScopesInputSchema = z
  .object({
    query: querySchema,
    repoId: repoIdSchema,
    profile: profileSchema,
    audience: z.array(docAudienceSchema).optional(),
    purpose: z.array(docPurposeSchema).optional(),
    visibility: z.array(docVisibilitySchema).optional(),
    limit: limitSchema,
  })
  .strict();

/** Input schema for precise document and passage search. */
export const findDocsInputSchema = z
  .object({
    query: querySchema,
    repoId: repoIdSchema,
    scopeIds: z.array(z.string().trim().min(1)).max(20).optional(),
    documentKinds: z
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
      .optional()
      .describe("Document metadata kinds used to filter matching hits."),
    targetTypes: z
      .array(z.enum(["document", "section", "chunk", "skill"]))
      .max(4)
      .optional()
      .describe("Stored result types to return."),
    profile: profileSchema,
    audience: z.array(docAudienceSchema).optional(),
    purpose: z.array(docPurposeSchema).optional(),
    visibility: z.array(docVisibilitySchema).optional(),
    limit: limitSchema,
  })
  .strict();

/** Input schema for a compact document outline or one exact section. */
export const readDocumentInputSchema = z
  .object({
    docId: z.string().trim().min(1),
    sectionId: z.string().trim().min(1).optional(),
    heading: z
      .array(z.string().trim().min(1))
      .min(1)
      .optional()
      .describe(
        "Exact heading path. When the caller already knows it, pass it directly instead of requesting an outline first.",
      ),
  })
  .strict()
  .refine(
    (value) => !(value.sectionId !== undefined && value.heading !== undefined),
    {
      message: "Pass either sectionId or heading, not both.",
    },
  );

/** Input schema for browsing or resolving a stored skill. */
export const useSkillInputSchema = z
  .object({
    skill: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Exact skill ID, title, or invocation alias."),
    task: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Natural-language task used to rank stored skills."),
    repoId: repoIdSchema,
    packageId: z.string().trim().min(1).optional(),
    moduleId: z.string().trim().min(1).optional(),
    agent: z.string().trim().min(1).optional(),
    limit: limitSchema,
  })
  .strict();

/** Input schema for expand_related. */
export const expandRelatedInputSchema = z
  .object({
    targetType: z.enum(["document", "section", "chunk", "skill", "summary"]),
    targetId: z.string().trim().min(1),
    query: querySchema
      .optional()
      .describe(
        "Optional missing related claim used to rank documents around the stable anchor.",
      ),
    limit: limitSchema,
  })
  .strict();

/** Input schema for plan_context. */
export const planContextInputSchema = z
  .object({
    query: querySchema,
    scope: z
      .object({
        repoId: z.string().trim().min(1).optional(),
        packageId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Stored package ID, package name, or repository-relative package path. Omit when the package is unknown and keep any human-readable package reference in query.",
          ),
        moduleId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Stored module ID, module name, or repository-relative module path. Omit when the module is unknown and keep any human-readable module reference in query.",
          ),
      })
      .strict()
      .optional()
      .describe(
        "Optional exact scope. Package and module fields accept stored IDs, names, or repository-relative paths; omit constraints the user did not supply.",
      ),
    budgetTokens: z.number().int().min(1).max(200_000).default(2_000),
    candidateLimit: limitSchema,
    summaryLimit: selectionLimitSchema,
    expansionLimit: selectionLimitSchema,
    profile: profileSchema,
    audience: z.array(docAudienceSchema).optional(),
    purpose: z.array(docPurposeSchema).optional(),
    visibility: z.array(docVisibilitySchema).optional(),
    detail: z.enum(["agent", "debug"]).default("agent"),
  })
  .strict();

export type FindScopesInput = z.infer<typeof findScopesInputSchema>;
export type FindDocsInput = z.infer<typeof findDocsInputSchema>;
export type ReadDocumentInput = z.infer<typeof readDocumentInputSchema>;
export type UseSkillInput = z.infer<typeof useSkillInputSchema>;
export type ExpandRelatedInput = z.infer<typeof expandRelatedInputSchema>;
export type PlanContextToolInput = Omit<
  z.input<typeof planContextInputSchema>,
  "detail"
> & {
  detail?: "agent" | "debug";
};
