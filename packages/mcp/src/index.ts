export type { McpErrorContext } from "./errors";
export {
  AtlasMcpError,
  McpDependencyError,
  McpResourceNotFoundError,
  McpToolValidationError,
  McpTransportError,
} from "./errors";
export { promptResult, resourceResult, toolResult } from "./mcp-result";
export { createRemoteMcpProxy } from "./http-proxy";
export type { RemoteMcpProxy } from "./http-proxy";
export { answerFromLocalDocsPrompt } from "./prompts/answer-from-local-docs.prompt";
export { compareDocsPrompt } from "./prompts/compare-docs.prompt";
export { explainSkillUsagePrompt } from "./prompts/explain-skill-usage.prompt";
export { onboardToModulePrompt } from "./prompts/onboard-to-module.prompt";
export { onboardToRepoPrompt } from "./prompts/onboard-to-repo.prompt";
export type { AtlasPromptDefinition } from "./prompts/prompt-utils";
export { registerAtlasPrompt } from "./prompts/prompt-utils";
export { summarizeModulePrompt } from "./prompts/summarize-module.prompt";
export { documentResource } from "./resources/document.resource";
export {
  buildIndexedSourceCatalog,
  discoveryDescription,
  discoveryInstructions,
} from "./discovery/indexed-source-catalog";
export type {
  IndexedSourceCatalog,
  IndexedSourceCatalogEntry,
} from "./discovery/indexed-source-catalog";
export { manifestResource } from "./resources/manifest.resource";
export { registerIndexedSourceResource } from "./resources/indexed-source.resource";
export { moduleResource } from "./resources/module.resource";
export { packageResource } from "./resources/package.resource";
export { repoResource } from "./resources/repo.resource";
export type { AtlasResourceDefinition } from "./resources/resource-utils";
export { registerAtlasResource, resourceId } from "./resources/resource-utils";
export { skillResource } from "./resources/skill.resource";
export { skillArtifactResource } from "./resources/skill-artifact.resource";
export { summaryResource } from "./resources/summary.resource";
export type {
  ExpandRelatedInput,
  FindDocsInput,
  FindScopesInput,
  PlanContextToolInput,
  ReadDocumentInput,
  UseSkillInput,
} from "./schemas/tool-schemas";
export {
  expandRelatedInputSchema,
  findDocsInputSchema,
  findScopesInputSchema,
  limitSchema,
  planContextInputSchema,
  querySchema,
  readDocumentInputSchema,
  repoIdSchema,
  useSkillInputSchema,
} from "./schemas/tool-schemas";
export {
  expandRelatedOutputSchema,
  findDocsOutputSchema,
  findScopesOutputSchema,
  planContextOutputSchema,
  readDocumentOutputSchema,
  useSkillOutputSchema,
} from "./schemas/tool-output-schemas";
export { createAtlasMcpServer } from "./server/create-mcp-server";
export {
  ATLAS_MCP_CAPABILITIES,
  ATLAS_MCP_SERVER_METADATA,
  createAtlasMcpServerMetadata,
} from "./server/metadata";
export type {
  AtlasMcpTransportMode,
  CreateAtlasTransportOptions,
} from "./server/transports";
export {
  createAtlasTransport,
  createStdioTransport,
  createStreamableHttpTransport,
  createWebStandardStreamableHttpTransport,
} from "./server/transports";
export {
  EXPAND_RELATED_TOOL,
  executeExpandRelated,
  registerExpandRelatedTool,
} from "./tools/expand-related.tool";
export {
  executeFindDocs,
  FIND_DOCS_TOOL,
  registerFindDocsTool,
} from "./tools/find-docs.tool";
export {
  executeFindScopes,
  FIND_SCOPES_TOOL,
  registerFindScopesTool,
} from "./tools/find-scopes.tool";
export {
  executePlanContext,
  PLAN_CONTEXT_TOOL,
  registerPlanContextTool,
  registerSourcePlanContextTool,
} from "./tools/plan-context.tool";
export {
  executeReadDocument,
  READ_DOCUMENT_TOOL,
  registerReadDocumentTool,
} from "./tools/read-document.tool";
export {
  executeUseSkill,
  registerUseSkillTool,
  USE_SKILL_TOOL,
} from "./tools/use-skill.tool";
export { ATLAS_MCP_DISCOVERY_POLICIES, ATLAS_MCP_TOOL_PROFILES } from "./types";
export type { AtlasMcpDiscoveryPolicy } from "./types";
export type {
  AtlasMcpDependencies,
  AtlasMcpDiagnostic,
  AtlasMcpExposurePolicy,
  AtlasMcpToolProfile,
  AtlasMcpIdentity,
  AtlasRetrievalMcpDependencies,
  AtlasMcpServer,
  McpJsonObject,
} from "./types";
