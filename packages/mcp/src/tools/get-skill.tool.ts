import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { toolResult } from "../mcp-result";
import { getSkillInputSchema, jsonOutputSchema, type GetSkillInput } from "../schemas/tool-schemas";
import { getDocument, getSkill, listSummaries, provenanceFromDocument } from "../store-mappers";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const GET_SKILL_TOOL = "get_skill";

/** Reads one stored skill artifact and its source provenance. */
export function executeGetSkill(input: GetSkillInput, dependencies: AtlasMcpDependencies): McpJsonObject {
  const parsed = getSkillInputSchema.parse(input);
  const skill = getSkill(dependencies.db, parsed.skillId);
  if (skill === undefined) {
    throw new McpResourceNotFoundError("Skill was not found.", { operation: "getSkill", entity: parsed.skillId });
  }
  const document = getDocument(dependencies.db, skill.sourceDocId);
  return {
    skill,
    summaries: listSummaries(dependencies.db, "skill", skill.skillId),
    provenance:
      document === undefined
        ? undefined
        : provenanceFromDocument(document, undefined, skill.skillId)
  };
}

/** Registers the get_skill MCP tool. */
export function registerGetSkillTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    GET_SKILL_TOOL,
    {
      title: "Get ATLAS skill",
      description: "Read a stored skill artifact by ID.",
      inputSchema: getSkillInputSchema,
      outputSchema: jsonOutputSchema
    },
    (input) => toolResult(executeGetSkill(input, dependencies))
  );
}
