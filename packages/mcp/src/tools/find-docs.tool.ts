import { findDocs } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import { findDocsOutputSchema } from "../schemas/tool-output-schemas";
import {
  type FindDocsInput,
  findDocsInputSchema,
} from "../schemas/tool-schemas";
import type { AtlasRetrievalMcpDependencies, McpJsonObject } from "../types";

export const FIND_DOCS_TOOL = "find_docs";

/** Executes document-oriented ranked retrieval for an MCP caller. */
export function executeFindDocs(
  input: FindDocsInput,
  dependencies: AtlasRetrievalMcpDependencies,
): McpJsonObject {
  const parsed = findDocsInputSchema.parse(input);
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
  return findDocsOutputSchema.parse({
    ...result,
    nextAction: result.hits.length === 0 ? "web_fallback" : "answer_locally",
    nextActionGuidance:
      result.hits.length === 0
        ? "TERMINAL: indexed evidence is absent. Use an external source if the claim still requires an answer."
        : "TERMINAL: answer_locally now from the highest-ranked supporting textPreview. Do not call another Atlas tool. The preview is the answer-bearing passage; cite its provenance path.",
  });
}

/** Registers the find_docs MCP tool. */
export function registerFindDocsTool(
  server: McpServer,
  dependencies: AtlasRetrievalMcpDependencies,
): void {
  server.registerTool(
    FIND_DOCS_TOOL,
    {
      title: "Find indexed passages",
      description:
        "Use first and call exactly once for an exact value, default, identity, knob, rule, short list, location, one missing claim from a partial answer, or retrieval debugging. Pass the user's complete exact lookup question as query; do not shorten it to a topic label. For a mixed local-policy and current-external-fact question, use find_docs for the precise local claim and gather the required external evidence separately. Returns ranked hits plus a terminal nextAction. When nextAction is answer_locally, the highest-ranked textPreview is the answer-bearing passage: answer and cite it immediately without another Atlas call. Never refine by repeating find_docs or infer repository-wide absence from its bounded hit set. Use plan_context only for ambiguity, comparison, module boundaries, or multi-passage planning.",
      inputSchema: findDocsInputSchema,
      outputSchema: findDocsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeFindDocs(input, dependencies)),
  );
}
