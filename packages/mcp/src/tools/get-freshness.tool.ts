import { computeFreshness } from "@atlas/core";
import { ManifestRepository, RepoRepository, type ManifestRecord, type RepoRecord } from "@atlas/store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { toolResult } from "../mcp-result";
import { getFreshnessInputSchema, jsonOutputSchema, type GetFreshnessInput } from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const GET_FRESHNESS_TOOL = "get_freshness";

/** Returns local store freshness by comparing repo revisions with manifest indexed revisions. */
export function executeGetFreshness(input: GetFreshnessInput, dependencies: AtlasMcpDependencies): McpJsonObject {
  const parsed = getFreshnessInputSchema.parse(input);
  const repos = resolveRepos(dependencies, parsed.repoId);
  const manifests = new ManifestRepository(dependencies.db);
  const freshness = repos.map((repo) => presentFreshness(repo, manifests.get(repo.repoId)));

  return {
    freshness,
    diagnostics: [
      {
        stage: "get_freshness",
        message: "Computed local freshness from stored repository and manifest revisions.",
        metadata: {
          repoId: parsed.repoId,
          repos: freshness.length,
          stale: freshness.filter((row) => row.stale).length
        }
      }
    ]
  };
}

/** Registers the get_freshness MCP tool. */
export function registerGetFreshnessTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    GET_FRESHNESS_TOOL,
    {
      title: "Get ATLAS freshness",
      description: "Return local freshness by comparing stored repo revisions with indexed manifest revisions.",
      inputSchema: getFreshnessInputSchema,
      outputSchema: jsonOutputSchema
    },
    (input) => toolResult(executeGetFreshness(input, dependencies))
  );
}

function resolveRepos(dependencies: AtlasMcpDependencies, repoId: string | undefined): RepoRecord[] {
  const repos = new RepoRepository(dependencies.db);
  if (repoId === undefined) {
    return repos.list();
  }
  const repo = repos.get(repoId);
  if (repo === undefined) {
    throw new McpResourceNotFoundError("Repository was not found.", { operation: "getFreshness", entity: repoId });
  }
  return [repo];
}

function presentFreshness(repo: RepoRecord, manifest: ManifestRecord | undefined): McpJsonObject {
  return {
    ...computeFreshness({
      repoId: repo.repoId,
      repoRevision: repo.revision,
      indexedRevision: manifest?.indexedRevision,
      lastSyncAt: manifest?.buildTimestamp,
      partialRevision: manifest?.partialRevision,
      partialBuildTimestamp: manifest?.partialBuildTimestamp,
      partialSelector: manifest?.partialSelector
    }),
    manifest
  };
}
