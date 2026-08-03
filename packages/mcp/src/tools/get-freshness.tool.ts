import { readFreshness } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { executeMcpRead } from "../errors";
import { toolResult } from "../mcp-result";
import {
  getFreshnessInputSchema,
  jsonOutputSchema,
  type GetFreshnessInput,
} from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const GET_FRESHNESS_TOOL = "get_freshness";

/** Returns local store freshness by comparing repo revisions with manifest indexed revisions. */
export function executeGetFreshness(
  input: GetFreshnessInput,
  dependencies: AtlasMcpDependencies,
): McpJsonObject {
  const parsed = getFreshnessInputSchema.parse(input);
  const freshness = executeMcpRead(() =>
    readFreshness(dependencies.db, parsed.repoId),
  );
  return {
    freshness,
    diagnostics: [
      {
        stage: "get_freshness",
        message:
          "Computed local freshness from stored repository and manifest revisions.",
        metadata: {
          repoId: parsed.repoId,
          repos: freshness.length,
          stale: freshness.filter((row) => row.stale).length,
        },
      },
    ],
  };
}

/** Registers the get_freshness MCP tool. */
export function registerGetFreshnessTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
): void {
  server.registerTool(
    GET_FRESHNESS_TOOL,
    {
      title: "Get ATLAS freshness",
      description:
        "Return local freshness by comparing stored repo revisions with indexed manifest revisions.",
      inputSchema: getFreshnessInputSchema,
      outputSchema: jsonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeGetFreshness(input, dependencies)),
  );
}
