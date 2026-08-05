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
    nextActionGuidance:
      result.hits.length === 0
        ? "No indexed hit supports this claim. Use an external source if the claim still requires an answer."
        : "STOP: answer now from the highest-ranked supporting textPreview. If that preview is truncated, call read_document once for the same hit. Do not repeat find_docs or refine the query, and do not infer repository-wide absence from the bounded hit set.",
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
        "Call exactly once for an exact rule or location, one missing claim from a partial answer, or retrieval debugging. Returns ranked document, section, chunk, or skill hits with text previews. Never refine by repeating find_docs or infer repository-wide absence from its bounded hit set; answer from the highest-ranked supporting preview or read that hit once when truncated. Use plan_context only for ambiguity, comparison, module boundaries, or multi-passage planning.",
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
