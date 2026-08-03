import { readSkill } from "@atlas/retrieval";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { executeMcpRead } from "../errors";
import { toolResult } from "../mcp-result";
import {
  getSkillInputSchema,
  jsonOutputSchema,
  type GetSkillInput,
} from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const GET_SKILL_TOOL = "get_skill";

/** Reads one stored skill artifact and its source provenance. */
export function executeGetSkill(
  input: GetSkillInput,
  dependencies: AtlasMcpDependencies,
): McpJsonObject {
  const parsed = getSkillInputSchema.parse(input);
  const result = executeMcpRead(() =>
    readSkill(dependencies.db, parsed.skillId),
  );
  return {
    skill: result.skill,
    summaries: result.summaries,
    provenance: result.provenance,
  };
}

/** Registers the get_skill MCP tool. */
export function registerGetSkillTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
): void {
  server.registerTool(
    GET_SKILL_TOOL,
    {
      title: "Get ATLAS skill",
      description: "Read a stored skill artifact by ID.",
      inputSchema: getSkillInputSchema,
      outputSchema: jsonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeGetSkill(input, dependencies)),
  );
}
