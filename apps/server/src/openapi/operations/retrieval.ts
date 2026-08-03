import { z } from "zod";

import {
  findDocsBodySchema,
  findScopesBodySchema,
} from "../../schemas/search.schema";
import { planContextBodySchema } from "../../schemas/context.schema";
import { jsonRequest, okResponses, operation } from "./helpers";

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

export const retrievalDocs = {
  findScopes: operation({
    tags: ["Retrieval"],
    operationId: "findScopes",
    summary: "Infer relevant scopes",
    description:
      "Classifies a natural-language query such as How does authentication work? and returns likely package/module scopes from the local corpus only.",
    requestBody: jsonRequest(
      findScopesBodySchema,
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
      findDocsBodySchema,
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
      planContextBodySchema,
      "Context planning request. Example budgetTokens: 2000. Example query: How does authentication work?.",
    ),
    responses: okResponses(contextPlanSchema),
  }),
} as const;
