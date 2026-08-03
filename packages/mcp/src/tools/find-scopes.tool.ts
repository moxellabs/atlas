import { findScopes } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import {
  findScopesInputSchema,
  jsonOutputSchema,
  type FindScopesInput,
} from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const FIND_SCOPES_TOOL = "find_scopes";

/** Executes scope inference for an MCP caller. */
export function executeFindScopes(
  input: FindScopesInput,
  dependencies: AtlasMcpDependencies,
): McpJsonObject {
  const parsed = findScopesInputSchema.parse(input);
  return {
    ...findScopes({
      db: dependencies.db,
      query: parsed.query,
      ...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
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

/** Registers the find_scopes MCP tool. */
export function registerFindScopesTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
): void {
  server.registerTool(
    FIND_SCOPES_TOOL,
    {
      title: "Find ATLAS scopes",
      description:
        "Infer likely repository, package, module, or skill scopes for a query.",
      inputSchema: findScopesInputSchema,
      outputSchema: jsonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeFindScopes(input, dependencies)),
  );
}
