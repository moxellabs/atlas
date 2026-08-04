import { findScopes } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import { findScopesOutputSchema } from "../schemas/tool-output-schemas";
import {
  findScopesInputSchema,
  type FindScopesInput,
} from "../schemas/tool-schemas";
import type { AtlasRetrievalMcpDependencies, McpJsonObject } from "../types";

export const FIND_SCOPES_TOOL = "find_scopes";

/** Executes scope inference for an MCP caller. */
export function executeFindScopes(
  input: FindScopesInput,
  dependencies: AtlasRetrievalMcpDependencies,
): McpJsonObject {
  const parsed = findScopesInputSchema.parse(input);
  return findScopesOutputSchema.parse(
    findScopes({
      store: dependencies.retrievalStore,
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
  );
}

/** Registers the find_scopes MCP tool. */
export function registerFindScopesTool(
  server: McpServer,
  dependencies: AtlasRetrievalMcpDependencies,
): void {
  server.registerTool(
    FIND_SCOPES_TOOL,
    {
      title: "Inspect inferred scopes",
      description:
        "Advanced and debugging tool for inspecting repository, package, module, or skill scope inference. Normal answer flows should use plan_context, which already returns inferred scopes.",
      inputSchema: findScopesInputSchema,
      outputSchema: findScopesOutputSchema,
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
