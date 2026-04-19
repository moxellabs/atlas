import { loadConfig, resolveIdentityProfile, type ResolvedAtlasConfig } from "@atlas/config";
import { computeSourceDiff, createIndexerServices, type IndexerDependencies } from "@atlas/indexer";
import type { AtlasSourceDiffProvider } from "@atlas/mcp";
import { openStore, type AtlasStoreClient } from "@atlas/store";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ServerEnv } from "../env";
import { McpBridgeService } from "./mcp-bridge.service";
import { BuildOperationsService } from "./build-operations.service";
import { RetrievalHttpService } from "./retrieval-http.service";
import { StoreReadService } from "./store-read.service";
import type { AtlasServerDependencies } from "./types";

const SERVER_SERVICES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_SERVICES_DIR, "..", "..", "..", "..");

/** Builds the explicit server dependency graph from validated env and ATLAS config. */
export async function buildServerDependencies(env: ServerEnv, config?: ResolvedAtlasConfig): Promise<AtlasServerDependencies> {
  const resolvedConfig = config ?? (await loadConfig({ cwd: REPO_ROOT }));
  const db = openStore({ path: resolvedConfig.config.corpusDbPath, migrate: true });
  const runtime = createConfigBoundServices(env, resolvedConfig, db);
  const dependencies: AtlasServerDependencies = {
    env: {
      ...env,
      host: env.host,
      port: env.port
    },
    config: resolvedConfig,
    db,
    store: new StoreReadService(db),
    retrieval: new RetrievalHttpService(db),
    operations: runtime.operations,
    ...(runtime.mcp === undefined ? {} : { mcp: runtime.mcp, mcpServer: runtime.mcp.atlasMcpServer }),
    reloadConfig(nextConfig) {
      const nextRuntime = createConfigBoundServices(env, nextConfig, db);
      dependencies.config = nextConfig;
      dependencies.operations = nextRuntime.operations;
      if (nextRuntime.mcp === undefined) {
        dependencies.mcp = undefined;
        dependencies.mcpServer = undefined;
      } else {
        dependencies.mcp = nextRuntime.mcp;
        dependencies.mcpServer = nextRuntime.mcp.atlasMcpServer;
      }
    }
  };
  return dependencies;
}

function createConfigBoundServices(env: ServerEnv, config: ResolvedAtlasConfig, db: AtlasStoreClient): Pick<AtlasServerDependencies, "operations" | "mcp"> {
  const { deps: indexerDeps, service: indexer } = createIndexerServices({
    config,
    db
  });
  const mcpIdentity = resolveIdentityProfile({
    envIdentityRoot: config.env.ATLAS_IDENTITY_ROOT,
    configIdentity: config.config.identity,
    mcp: {
      envMcpName: config.env.ATLAS_MCP_NAME,
      envMcpTitle: config.env.ATLAS_MCP_TITLE
    }
  }).mcpIdentity;
  const mcp = env.enableMcp ? new McpBridgeService(db, createSourceDiffProvider(indexerDeps), mcpIdentity) : undefined;
  return {
    operations: new BuildOperationsService(indexer),
    ...(mcp === undefined ? {} : { mcp })
  };
}

function createSourceDiffProvider(indexerDeps: IndexerDependencies): AtlasSourceDiffProvider {
  return {
    async diff(request) {
      const repo = indexerDeps.resolveRepo(request.repoId);
      const diff = await computeSourceDiff(repo, indexerDeps, request.fromRevision, request.toRevision);
      return {
        repoId: diff.repoId,
        fromRevision: request.fromRevision,
        toRevision: request.toRevision,
        changes: diff.changes,
        relevantChanges: diff.relevantChanges,
        relevantDocPaths: diff.relevantDocPaths,
        topologySensitivePaths: diff.topologySensitivePaths,
        packageManifestPaths: diff.packageManifestPaths,
        ...(diff.fullRebuildRequired === undefined ? {} : { fullRebuildRequired: diff.fullRebuildRequired }),
        ...(diff.fullRebuildReason === undefined ? {} : { fullRebuildReason: diff.fullRebuildReason })
      };
    }
  };
}

/** Closes server resources owned by dependencies. */
export function closeServerDependencies(dependencies: Pick<AtlasServerDependencies, "db">): void {
  dependencies.db.close();
}

export type { ResolvedAtlasConfig, AtlasStoreClient };
