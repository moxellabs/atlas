import { createRetrievalStore } from "@atlas/retrieval";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { answerFromLocalDocsPrompt } from "../prompts/answer-from-local-docs.prompt";
import { compareDocsPrompt } from "../prompts/compare-docs.prompt";
import { explainSkillUsagePrompt } from "../prompts/explain-skill-usage.prompt";
import { onboardToModulePrompt } from "../prompts/onboard-to-module.prompt";
import { onboardToRepoPrompt } from "../prompts/onboard-to-repo.prompt";
import { registerAtlasPrompt } from "../prompts/prompt-utils";
import { summarizeModulePrompt } from "../prompts/summarize-module.prompt";
import { documentResource } from "../resources/document.resource";
import {
  buildIndexedSourceCatalog,
  discoveryDescription,
  discoveryInstructions,
  type IndexedSourceCatalog,
} from "../discovery/indexed-source-catalog";
import { registerIndexedSourceResource } from "../resources/indexed-source.resource";
import { manifestResource } from "../resources/manifest.resource";
import { moduleResource } from "../resources/module.resource";
import { packageResource } from "../resources/package.resource";
import { repoResource } from "../resources/repo.resource";
import {
  registerAtlasResource,
  withResourceIdentity,
} from "../resources/resource-utils";
import { skillArtifactResource } from "../resources/skill-artifact.resource";
import { skillResource } from "../resources/skill.resource";
import { summaryResource } from "../resources/summary.resource";
import {
  EXPAND_RELATED_TOOL,
  registerExpandRelatedTool,
} from "../tools/expand-related.tool";
import {
  EXPLAIN_MODULE_TOOL,
  registerExplainModuleTool,
} from "../tools/explain-module.tool";
import { FIND_DOCS_TOOL, registerFindDocsTool } from "../tools/find-docs.tool";
import {
  FIND_SCOPES_TOOL,
  registerFindScopesTool,
} from "../tools/find-scopes.tool";
import {
  PLAN_CONTEXT_TOOL,
  registerPlanContextTool,
  registerSourcePlanContextTool,
} from "../tools/plan-context.tool";
import {
  READ_OUTLINE_TOOL,
  registerReadOutlineTool,
} from "../tools/read-outline.tool";
import {
  READ_SECTION_TOOL,
  registerReadSectionTool,
} from "../tools/read-section.tool";
import { USE_SKILL_TOOL, registerUseSkillTool } from "../tools/use-skill.tool";
import type {
  AtlasMcpDependencies,
  AtlasRetrievalMcpDependencies,
  AtlasMcpDiagnostic,
  AtlasMcpServer,
} from "../types";
import {
  ATLAS_MCP_CAPABILITIES,
  createAtlasMcpServerMetadata,
} from "./metadata";

const TOOL_NAMES = [
  PLAN_CONTEXT_TOOL,
  FIND_SCOPES_TOOL,
  FIND_DOCS_TOOL,
  READ_OUTLINE_TOOL,
  READ_SECTION_TOOL,
  EXPAND_RELATED_TOOL,
  EXPLAIN_MODULE_TOOL,
  USE_SKILL_TOOL,
] as const;
const BOUNDED_REMOTE_TOOL_NAMES = [
  PLAN_CONTEXT_TOOL,
  FIND_SCOPES_TOOL,
  FIND_DOCS_TOOL,
] as const;

const DEFAULT_RESOURCE_NAMES = [
  "atlas-manifest",
  "atlas-repo",
  "atlas-package",
  "atlas-module",
  "atlas-document",
  "atlas-skill",
  "atlas-skill-artifact",
  "atlas-summary",
] as const;
const PROMPT_NAMES = [
  "answer_from_local_docs",
  "onboard_to_module",
  "onboard_to_repo",
  "summarize_module",
  "compare_docs",
  "explain_skill_usage",
] as const;

/** Creates and registers the complete ATLAS MCP server surface. */
export function createAtlasMcpServer(
  dependencies: AtlasMcpDependencies,
): AtlasMcpServer {
  const diagnostics: AtlasMcpDiagnostic[] = [];
  let catalog = buildIndexedSourceCatalog(dependencies);
  const metadata = {
    ...createAtlasMcpServerMetadata(dependencies.identity),
    description: discoveryDescription(catalog),
  };
  const effectiveDependencies: AtlasRetrievalMcpDependencies = {
    ...dependencies,
    identity: metadata,
    retrievalStore: createRetrievalStore(dependencies.db),
  };
  const exposeAggregates = dependencies.exposurePolicy !== "bounded-remote";
  const resourceNames = exposeAggregates
    ? DEFAULT_RESOURCE_NAMES.map((name) =>
        name.startsWith("atlas-")
          ? `${metadata.resourcePrefix}-${name.slice("atlas-".length)}`
          : name,
      )
    : [];
  const server = new McpServer(
    {
      name: metadata.name,
      version: metadata.version,
      title: metadata.title,
      description: metadata.description,
    },
    {
      instructions: discoveryInstructions(
        catalog,
        dependencies.discoveryPolicy,
      ),
    },
  );

  const genericPlanTool = registerTools(server, effectiveDependencies, catalog);
  const dynamicTools = new Map<
    string,
    ReturnType<typeof registerSourcePlanContextTool>
  >();
  const dynamicResources = new Map<
    string,
    ReturnType<typeof registerIndexedSourceResource>
  >();
  const toolNames: string[] = [
    ...(exposeAggregates ? TOOL_NAMES : BOUNDED_REMOTE_TOOL_NAMES),
  ];
  const allResourceNames: string[] = [...resourceNames];
  const staticToolCount = toolNames.length;
  const staticResourceCount = allResourceNames.length;
  const registerSourceSurfaces = (nextCatalog: IndexedSourceCatalog) => {
    for (const source of nextCatalog.sources) {
      const tool = registerSourcePlanContextTool(
        server,
        effectiveDependencies,
        source,
      );
      dynamicTools.set(source.repoId, tool);
      if (exposeAggregates) {
        const resource = registerIndexedSourceResource(
          server,
          metadata.resourcePrefix,
          source,
        );
        dynamicResources.set(source.repoId, resource);
        allResourceNames.push(resource.name);
      }
      toolNames.push(tool.name);
    }
  };
  registerSourceSurfaces(catalog);
  diagnostics.push({
    stage: "tool",
    message: `Registered ${toolNames.length} MCP tools.`,
    metadata: { tools: [...toolNames] },
  });

  if (exposeAggregates)
    registerResources(server, effectiveDependencies, metadata);
  diagnostics.push({
    stage: "resource",
    message: `Registered ${allResourceNames.length} MCP resources.`,
    metadata: { resources: [...allResourceNames] },
  });

  registerPrompts(server);
  diagnostics.push({
    stage: "prompt",
    message: `Registered ${PROMPT_NAMES.length} MCP prompts.`,
    metadata: { prompts: [...PROMPT_NAMES] },
  });
  diagnostics.push({
    stage: "server",
    message: "Created ATLAS MCP server.",
    metadata: { metadata, capabilities: ATLAS_MCP_CAPABILITIES },
  });

  const result: AtlasMcpServer = {
    server,
    tools: toolNames,
    resources: allResourceNames,
    prompts: [...PROMPT_NAMES],
    diagnostics,
    refreshDiscovery: () => {
      const nextCatalog = buildIndexedSourceCatalog(dependencies);
      if (nextCatalog.fingerprint === catalog.fingerprint) return false;
      for (const registered of dynamicTools.values())
        registered.handle.remove();
      for (const registered of dynamicResources.values())
        registered.handle.remove();
      dynamicTools.clear();
      dynamicResources.clear();
      toolNames.splice(staticToolCount);
      allResourceNames.splice(staticResourceCount);
      catalog = nextCatalog;
      genericPlanTool.update({
        description: genericPlanDescription(catalog),
      });
      registerSourceSurfaces(catalog);
      server.sendToolListChanged();
      server.sendResourceListChanged();
      diagnostics.push({
        stage: "server",
        message: "Refreshed indexed-source MCP discovery surface.",
        metadata: { sources: catalog.sources.map((source) => source.repoId) },
      });
      return true;
    },
  };
  return result;
}

function registerTools(
  server: McpServer,
  dependencies: AtlasRetrievalMcpDependencies,
  catalog: IndexedSourceCatalog,
) {
  const planTool = registerPlanContextTool(server, dependencies, {
    description: genericPlanDescription(catalog),
  });
  registerFindScopesTool(server, dependencies);
  registerFindDocsTool(server, dependencies);
  if (dependencies.exposurePolicy !== "bounded-remote") {
    registerReadOutlineTool(server, dependencies);
    registerReadSectionTool(server, dependencies);
    registerExpandRelatedTool(server, dependencies);
    registerExplainModuleTool(server, dependencies);
    registerUseSkillTool(server, dependencies);
  }
  return planTool;
}

function registerResources(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
  identity: { resourcePrefix: string; title: string },
): void {
  for (const resource of [
    manifestResource,
    repoResource,
    packageResource,
    moduleResource,
    documentResource,
    skillResource,
    skillArtifactResource,
    summaryResource,
  ]) {
    registerAtlasResource(
      server,
      withResourceIdentity(resource, identity),
      dependencies,
    );
  }
}

function genericPlanDescription(catalog: IndexedSourceCatalog): string {
  const sourceNames = catalog.sources
    .slice(0, 6)
    .map(
      (source) => `${source.title} (${source.topics.slice(0, 8).join(", ")})`,
    )
    .join("; ");
  return `Find and package local evidence for a library, framework, API, or repository question. Returns coverage (sufficient, partial, absent, or stale), citations, and the next safe action. Indexed sources and topics: ${sourceNames || "none"}. Use repoId when the source is known.`;
}

function registerPrompts(server: McpServer): void {
  for (const prompt of [
    answerFromLocalDocsPrompt,
    onboardToModulePrompt,
    onboardToRepoPrompt,
    summarizeModulePrompt,
    compareDocsPrompt,
    explainSkillUsagePrompt,
  ]) {
    registerAtlasPrompt(server, prompt);
  }
}
