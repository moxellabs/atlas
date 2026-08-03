import { findDocs } from "@atlas/retrieval";
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
  return {
    ...findDocs({
      db: dependencies.db,
      query: parsed.query,
      ...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
      ...(parsed.scopeIds === undefined ? {} : { scopeIds: parsed.scopeIds }),
      ...(parsed.kinds === undefined ? {} : { kinds: parsed.kinds }),
      ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
      filters: {
        ...(parsed.profile === undefined ? {} : { profile: parsed.profile }),
        ...(parsed.audience === undefined ? {} : { audience: parsed.audience }),
        ...(parsed.purpose === undefined ? {} : { purpose: parsed.purpose }),
        ...(parsed.visibility === undefined
          ? {}
          : { visibility: parsed.visibility }),
      },
    }),
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
        "Return ranked document, section, chunk, or skill hits for a query. Prefer plan_context first when building an answer; pass repoId and profile (public, contributor, maintainer, internal) or explicit metadata filters to avoid searching the wrong corpus slice.",
      inputSchema: findDocsInputSchema,
      outputSchema: jsonOutputSchema,
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
