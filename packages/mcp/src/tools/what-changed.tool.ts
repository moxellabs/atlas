import { DocRepository } from "@atlas/store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { toolResult } from "../mcp-result";
import { jsonOutputSchema, whatChangedInputSchema, type WhatChangedInput } from "../schemas/tool-schemas";
import { getManifest, getRepo } from "../store-mappers";
import type { AtlasMcpDependencies, AtlasSourceDiffResult, McpJsonObject } from "../types";

export const WHAT_CHANGED_TOOL = "what_changed";

/** Reads source-backed changes when available, plus indexed document state. */
export async function executeWhatChanged(input: WhatChangedInput, dependencies: AtlasMcpDependencies): Promise<McpJsonObject> {
  const parsed = whatChangedInputSchema.parse(input);
  const repo = getRepo(dependencies.db, parsed.repoId);
  if (repo === undefined) {
    throw new McpResourceNotFoundError("Repository was not found.", { operation: "whatChanged", entity: parsed.repoId });
  }
  const manifest = getManifest(dependencies.db, parsed.repoId);
  const documents = new DocRepository(dependencies.db).listByRepo(parsed.repoId);
  const fromRevision = parsed.fromRevision ?? manifest?.indexedRevision ?? repo.revision;
  const toRevision = parsed.toRevision ?? repo.revision;
  const indexedDocuments = documents.map((document) => ({
    docId: document.docId,
    path: document.path,
    kind: document.kind,
    authority: document.authority,
    sourceVersion: document.sourceVersion
  }));
  const sourceDiff = await resolveSourceDiff(dependencies, parsed.repoId, fromRevision, toRevision, indexedDocuments);
  return {
    repo,
    manifest,
    requestedRange: {
      fromRevision,
      toRevision
    },
    indexedDocuments,
    sourceDiff
  };
}

async function resolveSourceDiff(
  dependencies: AtlasMcpDependencies,
  repoId: string,
  fromRevision: string,
  toRevision: string,
  indexedDocuments: Array<{ docId: string; path: string; kind: string; authority: string; sourceVersion: string }>
) {
  if (dependencies.sourceDiffProvider === undefined) {
    return {
      available: false,
      fromRevision,
      toRevision,
      reason: "No source diff provider is configured for this MCP runtime."
    };
  }
  const diff = await dependencies.sourceDiffProvider.diff({ repoId, fromRevision, toRevision });
  return presentSourceDiff(diff, indexedDocuments);
}

function presentSourceDiff(
  diff: AtlasSourceDiffResult,
  indexedDocuments: Array<{ docId: string; path: string; kind: string; authority: string; sourceVersion: string }>
) {
  const changedDocPaths = new Set(diff.relevantDocPaths);
  return {
    available: true,
    repoId: diff.repoId,
    fromRevision: diff.fromRevision,
    toRevision: diff.toRevision,
    changes: diff.changes,
    relevantChanges: diff.relevantChanges,
    relevantDocPaths: diff.relevantDocPaths,
    topologySensitivePaths: diff.topologySensitivePaths,
    packageManifestPaths: diff.packageManifestPaths,
    changedIndexedDocuments: indexedDocuments.filter((document) => changedDocPaths.has(document.path)),
    ...(diff.fullRebuildRequired === undefined ? {} : { fullRebuildRequired: diff.fullRebuildRequired }),
    ...(diff.fullRebuildReason === undefined ? {} : { fullRebuildReason: diff.fullRebuildReason })
  };
}

/** Registers the what_changed MCP tool. */
export function registerWhatChangedTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    WHAT_CHANGED_TOOL,
    {
      title: "Inspect ATLAS source changes",
      description: "Return source-backed changed paths and indexed document state for a repository.",
      inputSchema: whatChangedInputSchema,
      outputSchema: jsonOutputSchema
    },
    async (input) => toolResult(await executeWhatChanged(input, dependencies))
  );
}
