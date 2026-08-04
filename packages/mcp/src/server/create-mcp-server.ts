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
  READ_DOCUMENT_TOOL,
  registerReadDocumentTool,
} from "../tools/read-document.tool";
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

const AGENT_TOOL_NAMES = [
  PLAN_CONTEXT_TOOL,
  FIND_DOCS_TOOL,
  READ_DOCUMENT_TOOL,
  EXPAND_RELATED_TOOL,
  USE_SKILL_TOOL,
] as const;
const ADVANCED_TOOL_NAMES = [
  PLAN_CONTEXT_TOOL,
  FIND_SCOPES_TOOL,
  FIND_DOCS_TOOL,
  READ_DOCUMENT_TOOL,
  EXPAND_RELATED_TOOL,
  USE_SKILL_TOOL,
] as const;
const BOUNDED_REMOTE_AGENT_TOOL_NAMES = [
  PLAN_CONTEXT_TOOL,
  FIND_DOCS_TOOL,
] as const;
const BOUNDED_REMOTE_ADVANCED_TOOL_NAMES = [
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
  const exposeResources =
    dependencies.exposurePolicy !== "bounded-remote" &&
    dependencies.toolProfile === "advanced";
  const resourceNames = exposeResources
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
  const toolNames: string[] = [...staticToolNames(dependencies)];
  const allResourceNames: string[] = [...resourceNames];
  const staticToolCount = toolNames.length;
  const staticResourceCount = allResourceNames.length;
  const registerSourceSurfaces = (nextCatalog: IndexedSourceCatalog) => {
    if (exposeResources) {
      for (const source of nextCatalog.sources) {
        const resource = registerIndexedSourceResource(
          server,
          metadata.resourcePrefix,
          source,
        );
        dynamicResources.set(source.repoId, resource);
        allResourceNames.push(resource.name);
      }
    }
    for (const [index, source] of selectedSourceFacades(
      nextCatalog,
      dependencies,
    ).entries()) {
      const tool = registerSourcePlanContextTool(
        server,
        effectiveDependencies,
        source,
        { alwaysLoad: index === 0 },
      );
      dynamicTools.set(source.repoId, tool);
      toolNames.push(tool.name);
    }
  };
  registerSourceSurfaces(catalog);
  diagnostics.push({
    stage: "tool",
    message: `Registered ${toolNames.length} MCP tools.`,
    metadata: { tools: [...toolNames] },
  });

  if (exposeResources)
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
  registerFindDocsTool(server, dependencies);
  if (dependencies.toolProfile === "advanced") {
    registerFindScopesTool(server, dependencies);
  }
  if (dependencies.exposurePolicy !== "bounded-remote") {
    registerReadDocumentTool(server, dependencies);
    registerExpandRelatedTool(server, dependencies);
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

function staticToolNames(
  dependencies: AtlasMcpDependencies,
): readonly string[] {
  const advanced = dependencies.toolProfile === "advanced";
  if (dependencies.exposurePolicy === "bounded-remote") {
    return advanced
      ? BOUNDED_REMOTE_ADVANCED_TOOL_NAMES
      : BOUNDED_REMOTE_AGENT_TOOL_NAMES;
  }
  return advanced ? ADVANCED_TOOL_NAMES : AGENT_TOOL_NAMES;
}

function selectedSourceFacades(
  catalog: IndexedSourceCatalog,
  dependencies: AtlasMcpDependencies,
) {
  const preferredOrder = new Map(
    (dependencies.sourceFacadeRepoIds ?? []).map((repoId, index) => [
      repoId,
      index,
    ]),
  );
  const ordered = (
    preferredOrder.size === 0
      ? [...catalog.sources]
      : catalog.sources.filter((source) => preferredOrder.has(source.repoId))
  ).sort((left, right) => {
    const leftOrder = preferredOrder.get(left.repoId);
    const rightOrder = preferredOrder.get(right.repoId);
    if (leftOrder !== undefined || rightOrder !== undefined) {
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      return leftOrder - rightOrder;
    }
    return left.repoId.localeCompare(right.repoId);
  });
  return ordered.slice(0, dependencies.toolProfile === "advanced" ? 12 : 1);
}

function genericPlanDescription(catalog: IndexedSourceCatalog): string {
  const sourceNames = catalog.sources
    .slice(0, 6)
    .map(
      (source) => `${source.title} (${source.topics.slice(0, 8).join(", ")})`,
    )
    .join("; ");
  return `Build a multi-passage local evidence packet for an ambiguous, comparative, cross-source, or module-boundary question. Returns coverage (sufficient, partial, absent, or stale), citations, and the next safe action. For a broad overview of one named source, use its answer_<source>_docs facade instead. Indexed sources and topics: ${sourceNames || "none"}. Use scope.repoId when the source is known.`;
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
