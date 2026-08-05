import { findDocs } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import { searchPassagesOutputSchema } from "../schemas/tool-output-schemas";
import {
  type SearchPassagesInput,
  searchPassagesInputSchema,
} from "../schemas/tool-schemas";
import type { AtlasRetrievalMcpDependencies, McpJsonObject } from "../types";

export const SEARCH_PASSAGES_TOOL = "search_passages";

/** Searches ranked, answer-bearing passages for an MCP caller. */
export function executeSearchPassages(
  input: SearchPassagesInput,
  dependencies: AtlasRetrievalMcpDependencies,
): McpJsonObject {
  const parsed = searchPassagesInputSchema.parse(input);
  const result = findDocs({
    store: dependencies.retrievalStore,
    query: parsed.query,
    ...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
    ...(parsed.scopeIds === undefined ? {} : { scopeIds: parsed.scopeIds }),
    ...(parsed.documentKinds === undefined
      ? {}
      : { documentKinds: parsed.documentKinds }),
    ...(parsed.targetTypes === undefined
      ? {}
      : { targetTypes: parsed.targetTypes }),
    ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
    filters: {
      ...(parsed.profile === undefined ? {} : { profile: parsed.profile }),
      ...(parsed.audience === undefined ? {} : { audience: parsed.audience }),
      ...(parsed.purpose === undefined ? {} : { purpose: parsed.purpose }),
      ...(parsed.visibility === undefined
        ? {}
        : { visibility: parsed.visibility }),
    },
  });
  return searchPassagesOutputSchema.parse({
    ...result,
    nextAction: result.hits.length === 0 ? "web_fallback" : "answer_locally",
    nextActionGuidance:
      result.hits.length === 0
        ? "TERMINAL: indexed evidence is absent. Use an external source if the claim still requires an answer."
        : "TERMINAL: answer_locally now from the highest-ranked supporting textPreview. Do not call another Atlas tool. The preview is the answer-bearing passage; cite its provenance path.",
  });
}

/** Registers the search_passages MCP tool. */
export function registerSearchPassagesTool(
  server: McpServer,
  dependencies: AtlasRetrievalMcpDependencies,
): void {
  server.registerTool(
    SEARCH_PASSAGES_TOOL,
    {
      title: "Search indexed passages",
      description:
        "Search by natural-language query for one exact value, default, identity, knob, rule, short list, location, or missing claim. This discovers evidence across indexed content; it does not open a known document ID. Call exactly once with the user's complete lookup question rather than a shortened topic label. For a mixed local-policy and current-external-fact question, use search_passages for the precise local claim and gather the required external evidence separately. Returns ranked hits plus a terminal nextAction. When nextAction is answer_locally, the highest-ranked textPreview is the answer-bearing passage: answer and cite it immediately without another Atlas call. Never refine by repeating search_passages or infer repository-wide absence from its bounded hit set. Use plan_context only for ambiguity, comparison, module boundaries, or multi-passage planning.",
      inputSchema: searchPassagesInputSchema,
      outputSchema: searchPassagesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeSearchPassages(input, dependencies)),
  );
}
