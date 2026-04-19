import { classifyQuery, inferScopes } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import { findScopesInputSchema, jsonOutputSchema, type FindScopesInput } from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const FIND_SCOPES_TOOL = "find_scopes";

/** Executes scope inference for an MCP caller. */
export function executeFindScopes(input: FindScopesInput, dependencies: AtlasMcpDependencies): McpJsonObject {
  const parsed = findScopesInputSchema.parse(input);
  const classification = classifyQuery(parsed.query);
  const result = inferScopes({
    db: dependencies.db,
    query: parsed.query,
    classification,
    ...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
    ...(parsed.limit === undefined ? {} : { limit: parsed.limit })
  });
  return { query: parsed.query, classification, scopes: result.scopes, diagnostics: result.diagnostics };
}

/** Registers the find_scopes MCP tool. */
export function registerFindScopesTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    FIND_SCOPES_TOOL,
    {
      title: "Find ATLAS scopes",
      description: "Infer likely repository, package, module, or skill scopes for a query.",
      inputSchema: findScopesInputSchema,
      outputSchema: jsonOutputSchema
    },
    (input) => toolResult(executeFindScopes(input, dependencies))
  );
}
