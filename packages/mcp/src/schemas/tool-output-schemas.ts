import {
  AUTHORITIES,
  DOC_KINDS,
  QUERY_KINDS,
  REPOSITORY_REFRESH_STATUSES,
} from "@atlas/core";
import { z } from "zod";

const metadataSchema = z.record(z.string(), z.unknown());
const targetTypeSchema = z.enum([
  "summary",
  "document",
  "section",
  "chunk",
  "skill",
]);
const diagnosticSchema = z
  .object({
    stage: z.string(),
    message: z.string(),
    metadata: metadataSchema.optional(),
  })
  .strict();
const provenanceSchema = z
  .object({
    repoId: z.string(),
    packageId: z.string().optional(),
    moduleId: z.string().optional(),
    skillId: z.string().optional(),
    docId: z.string(),
    path: z.string(),
    headingPath: z.array(z.string()).optional(),
    sourceVersion: z.string(),
    authority: z.enum(AUTHORITIES),
  })
  .strict();
const queryClassificationSchema = z
  .object({
    query: z.string(),
    kind: z.enum(QUERY_KINDS),
    confidence: z.enum(["low", "medium", "high"]),
    score: z.number(),
    rationale: z.array(z.string()),
    signals: z.array(z.string()),
  })
  .strict();
const scopeSchema = z
  .object({
    level: z.enum(["repo", "package", "module", "skill"]),
    id: z.string(),
    label: z.string(),
    repoId: z.string(),
    packageId: z.string().optional(),
    moduleId: z.string().optional(),
    skillId: z.string().optional(),
    score: z.number(),
    rationale: z.array(z.string()),
  })
  .strict();
const rankingFactorsSchema = z
  .object({
    lexicalScore: z.number(),
    authority: z.number(),
    locality: z.number(),
    queryKind: z.number(),
    tokenEfficiency: z.number(),
    freshness: z.number(),
    evidenceMatch: z.number(),
    qualityAdjustment: z.number(),
    redundancyPenalty: z.number(),
  })
  .strict();
const rankedHitSchema = z
  .object({
    targetType: targetTypeSchema,
    targetId: z.string(),
    provenance: provenanceSchema,
    kind: z.enum(DOC_KINDS).optional(),
    authority: z.enum(AUTHORITIES),
    score: z.number(),
    tokenCount: z.number().int().nonnegative().optional(),
    textPreview: z.string().optional(),
    source: z
      .enum(["lexical", "path", "scope", "summary", "skill", "manual"])
      .optional(),
    rationale: z.array(z.string()),
    factors: rankingFactorsSchema,
  })
  .strict();
const ambiguitySchema = z
  .object({
    status: z.literal("ambiguous"),
    reason: z.string(),
    candidates: z.array(rankedHitSchema),
    recommendedNextActions: z.array(z.string()),
  })
  .strict();
const scopeContextSchema = z
  .object({
    repo: z.object({ repoId: z.string(), label: z.string() }).strict(),
    package: z
      .object({
        packageId: z.string(),
        name: z.string(),
        path: z.string(),
      })
      .strict()
      .optional(),
    module: z
      .object({ moduleId: z.string(), name: z.string(), path: z.string() })
      .strict()
      .optional(),
    skill: z
      .object({
        skillId: z.string(),
        title: z.string().optional(),
        sourceDocPath: z.string(),
      })
      .strict()
      .optional(),
    label: z.string(),
  })
  .strict();
const contextEvidenceSchema = z
  .object({
    targetType: targetTypeSchema,
    targetId: z.string(),
    label: z.string(),
    tokenCount: z.number().int().nonnegative(),
    score: z.number().optional(),
    provenance: provenanceSchema,
    scopeContext: scopeContextSchema.optional(),
    text: z.string().optional(),
    rationale: z.array(z.string()),
  })
  .strict();
const omissionReasonSchema = z.enum([
  "budget",
  "authority",
  "freshness",
  "quality",
  "archive",
  "redundancy",
]);
const contextPacketSchema = z
  .object({
    query: z.string(),
    budgetTokens: z.number().int().positive(),
    usedTokens: z.number().int().nonnegative(),
    confidence: z.enum(["low", "medium", "high"]),
    scopes: z.array(scopeSchema),
    evidence: z.array(contextEvidenceSchema),
    warnings: z.array(z.string()),
    omitted: z.array(
      z
        .object({
          targetType: targetTypeSchema,
          targetId: z.string(),
          label: z.string(),
          reason: z.string(),
          reasonCategory: omissionReasonSchema.optional(),
        })
        .strict(),
    ),
    omissionDiagnostics: z.array(
      z
        .object({
          reason: omissionReasonSchema,
          targetType: targetTypeSchema,
          targetId: z.string(),
          docId: z.string(),
          path: z.string(),
          explanation: z.string(),
        })
        .strict(),
    ),
    recommendedNextActions: z.array(z.string()),
  })
  .strict();
const repositoryRefreshSchema = z
  .object({
    repoId: z.string().optional(),
    status: z.enum(REPOSITORY_REFRESH_STATUSES),
    lastCheckedAt: z.string().optional(),
    lastSuccessfulRefreshAt: z.string().optional(),
    refreshStartedAt: z.string().optional(),
    sourceRevision: z.string().optional(),
    indexedRevision: z.string().optional(),
    changedPaths: z.array(z.string()),
    error: z
      .object({ code: z.string().optional(), message: z.string() })
      .strict()
      .optional(),
  })
  .strict();

export const findScopesOutputSchema = z
  .object({
    query: z.string(),
    classification: queryClassificationSchema,
    scopes: z.array(scopeSchema),
    diagnostics: z.array(diagnosticSchema),
  })
  .strict();

export const findDocsOutputSchema = z
  .object({
    query: z.string(),
    classification: queryClassificationSchema,
    hits: z.array(rankedHitSchema),
    filters: metadataSchema.optional(),
    ambiguity: ambiguitySchema.optional(),
    diagnostics: z.array(diagnosticSchema),
    nextActionGuidance: z.string(),
  })
  .strict();

const summarySchema = z
  .object({
    summaryId: z.string(),
    targetType: z.enum([
      "repo",
      "package",
      "module",
      "document",
      "section",
      "skill",
    ]),
    targetId: z.string(),
    level: z.enum(["short", "medium", "outline"]),
    text: z.string(),
    tokenCount: z.number().int().nonnegative(),
  })
  .strict();
const codeBlockSchema = z
  .object({ lang: z.string().optional(), code: z.string() })
  .strict();
const presentedDocumentSchema = z
  .object({
    docId: z.string(),
    repoId: z.string().optional(),
    title: z.string().optional(),
    kind: z.enum(DOC_KINDS),
    authority: z.enum(AUTHORITIES),
    path: z.string(),
    sourceVersion: z.string().optional(),
    packageId: z.string().optional(),
    moduleId: z.string().optional(),
    skillId: z.string().optional(),
    provenance: provenanceSchema.optional(),
  })
  .strict();
const sectionPreviewSchema = z
  .object({
    sectionId: z.string(),
    docId: z.string().optional(),
    headingPath: z.array(z.string()),
    ordinal: z.number().int().nonnegative(),
    preview: z.string(),
  })
  .strict();

export const readDocumentOutputSchema = z
  .object({
    status: z.enum(["outline", "section"]),
    document: presentedDocumentSchema.optional(),
    outline: z.array(sectionPreviewSchema).optional(),
    summaries: z.array(summarySchema).optional(),
    section: z
      .object({
        sectionId: z.string(),
        docId: z.string(),
        headingPath: z.array(z.string()),
        ordinal: z.number().int().nonnegative(),
        text: z.string(),
        codeBlocks: z.array(codeBlockSchema),
        provenance: provenanceSchema,
      })
      .strict()
      .optional(),
    nextActionGuidance: z.string(),
  })
  .strict();

const skillRecordSchema = z
  .object({
    skillId: z.string(),
    repoId: z.string(),
    packageId: z.string().optional(),
    moduleId: z.string().optional(),
    sourceDocId: z.string(),
    sourceDocPath: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    headings: z.array(z.array(z.string())),
    keySections: z.array(z.string()),
    topics: z.array(z.string()),
    aliases: z.array(z.string()),
    tokenCount: z.number().int().nonnegative(),
  })
  .strict();
const skillArtifactSummarySchema = z
  .object({
    scripts: z.number().int().nonnegative(),
    references: z.number().int().nonnegative(),
    agentProfiles: z.number().int().nonnegative(),
    other: z.number().int().nonnegative(),
  })
  .strict();
const skillCandidateSchema = z
  .object({
    skillId: z.string(),
    repoId: z.string(),
    packageId: z.string().optional(),
    moduleId: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    sourceDocPath: z.string(),
    topics: z.array(z.string()),
    aliases: z.array(z.string()),
    tokenCount: z.number().int().nonnegative(),
    invocationAliases: z.array(z.string()),
    artifactSummary: skillArtifactSummarySchema,
    hasScripts: z.boolean(),
    match: z
      .object({ score: z.number(), matchedTerms: z.array(z.string()) })
      .strict()
      .optional(),
  })
  .strict();
const skillArtifactSchema = z
  .object({
    skillId: z.string(),
    path: z.string(),
    kind: z.enum(["script", "reference", "agent-profile", "other"]),
    contentHash: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    mimeType: z.string().optional(),
    content: z.string().optional(),
  })
  .strict();
const skillDiagnosticSchema = z
  .object({ stage: z.string(), message: z.string() })
  .strict();

export const useSkillOutputSchema = z
  .object({
    status: z.enum(["not_found", "listed", "ambiguous", "resolved"]),
    skill: z
      .union([
        z.string(),
        skillRecordSchema.extend({ invocationAliases: z.array(z.string()) }),
      ])
      .optional(),
    task: z.string().optional(),
    total: z.number().int().nonnegative().optional(),
    skills: z.array(skillCandidateSchema).optional(),
    candidates: z.array(skillCandidateSchema).optional(),
    resolution: z
      .object({
        method: z.enum(["exact", "task"]),
        score: z.number().optional(),
        matchedTerms: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    requestedSkill: z.string().optional(),
    instructions: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        sourceDocumentPath: z.string(),
        markdown: z.string(),
        keySections: z.array(z.string()),
      })
      .strict()
      .optional(),
    artifacts: z
      .array(
        skillArtifactSchema.extend({
          uri: z.string(),
          execution: z.enum(["served-only", "not-executable"]),
        }),
      )
      .optional(),
    selectedAgentProfile: skillArtifactSchema.optional(),
    summaries: z.array(summarySchema).optional(),
    freshness: metadataSchema.optional(),
    provenance: provenanceSchema.optional(),
    diagnostics: z.array(skillDiagnosticSchema).optional(),
    recommendedNextActions: z.array(z.string()),
  })
  .strict();

const relatedDocumentSchema = presentedDocumentSchema
  .omit({ provenance: true })
  .extend({ description: z.string().optional() });
const relatedSectionSchema = sectionPreviewSchema.extend({ docId: z.string() });
const relatedChunkSchema = z
  .object({
    chunkId: z.string(),
    docId: z.string(),
    sectionId: z.string().optional(),
    headingPath: z.array(z.string()),
    ordinal: z.number().int().nonnegative(),
    tokenCount: z.number().int().nonnegative(),
    preview: z.string(),
  })
  .strict();

export const expandRelatedOutputSchema = z
  .object({
    anchor: z
      .object({
        targetType: z.enum([
          "document",
          "section",
          "chunk",
          "skill",
          "summary",
        ]),
        targetId: z.string(),
        document: relatedDocumentSchema.optional(),
        provenance: provenanceSchema.optional(),
        section: relatedSectionSchema.optional(),
        chunk: relatedChunkSchema.optional(),
        skill: skillRecordSchema.optional(),
        summary: summarySchema.optional(),
      })
      .strict(),
    related: z
      .object({
        documents: z.array(relatedDocumentSchema),
        sections: z.array(relatedSectionSchema),
        summaries: z.array(summarySchema),
        skills: z.array(skillRecordSchema),
      })
      .strict(),
    diagnostics: z.array(diagnosticSchema),
    nextActionGuidance: z.string(),
  })
  .strict();

export const planContextOutputSchema = z
  .object({
    query: z.string(),
    coverage: z
      .object({
        status: z.enum(["sufficient", "partial", "absent", "stale"]),
        selectedSources: z.array(
          z
            .object({
              repoId: z.string(),
              fresh: z.boolean(),
              stale: z.boolean(),
              repositoryRefresh: repositoryRefreshSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    nextAction: z.enum(["answer_locally", "refine_locally", "web_fallback"]),
    nextActionGuidance: z.string(),
    context: contextPacketSchema,
    citations: z.array(
      z
        .object({ repoId: z.string(), path: z.string(), docId: z.string() })
        .strict(),
    ),
    recentChanges: z
      .array(
        z
          .object({
            repoId: z.string(),
            status: z.enum(REPOSITORY_REFRESH_STATUSES),
            changedPaths: z.array(z.string()),
            lastCheckedAt: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    debug: z
      .object({
        query: z.string(),
        budgetTokens: z.number().int().positive(),
        usedTokens: z.number().int().nonnegative(),
        selected: z.array(z.unknown()),
        omitted: z.array(z.unknown()),
        rankedHits: z.array(rankedHitSchema),
      })
      .passthrough()
      .optional(),
  })
  .strict();

export type PlanContextOutput = z.infer<typeof planContextOutputSchema>;
