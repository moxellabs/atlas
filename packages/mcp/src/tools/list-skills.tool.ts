import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import { jsonOutputSchema, listSkillsInputSchema, type ListSkillsInput } from "../schemas/tool-schemas";
import { listSkills, summarizeSkillArtifacts } from "../store-mappers";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const LIST_SKILLS_TOOL = "list_skills";

/** Lists stored skills for optional repo/package/module scope constraints. */
export function executeListSkills(input: ListSkillsInput, dependencies: AtlasMcpDependencies): McpJsonObject {
  const parsed = listSkillsInputSchema.parse(input);
  return {
    skills: listSkills(dependencies.db, {
      ...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
      ...(parsed.packageId === undefined ? {} : { packageId: parsed.packageId }),
      ...(parsed.moduleId === undefined ? {} : { moduleId: parsed.moduleId }),
      ...(parsed.limit === undefined ? {} : { limit: parsed.limit })
    }).map((skill) => {
      const artifactSummary = summarizeSkillArtifacts(dependencies.db, skill.skillId);
      return {
        ...skill,
        invocationAliases: invocationAliasesForSkill(skill, dependencies.identity?.resourcePrefix ?? "atlas"),
        artifactSummary,
        hasScripts: artifactSummary.scripts > 0
      };
    })
  };
}

/** Registers the list_skills MCP tool. */
export function registerListSkillsTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    LIST_SKILLS_TOOL,
    {
      title: `List ${dependencies.identity?.title ?? "ATLAS"} skills`,
      description: "List stored skills with optional scope constraints.",
      inputSchema: listSkillsInputSchema,
      outputSchema: jsonOutputSchema
    },
    (input) => toolResult(executeListSkills(input, dependencies))
  );
}

function invocationAliasesForSkill(skill: { title?: string | undefined; sourceDocPath: string; aliases: readonly string[] }, prefix: string): string[] {
  const names = [skillSlug(skill.sourceDocPath), skill.title, ...skill.aliases].flatMap((value) => {
    const slug = slugify(value);
    return slug === undefined ? [] : [`${prefix}-${slug}`, `$${prefix}-${slug}`];
  });
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function skillSlug(sourceDocPath: string): string | undefined {
  const parts = sourceDocPath.split("/").filter(Boolean);
  const file = parts.at(-1);
  if (file === undefined) {
    return undefined;
  }
  if (file.toLowerCase() === "skill.md") {
    return parts.at(-2);
  }
  return file.replace(/\.md$/i, "");
}

function slugify(value: string | undefined): string | undefined {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === undefined || slug.length === 0 ? undefined : slug;
}
