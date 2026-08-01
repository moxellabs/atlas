import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  type ResolvedAtlasConfig,
  resolveIdentityProfile,
} from "@atlas/config";
import {
  computeSourceDiff,
  createIndexerServices,
  type IndexerDependencies,
} from "@atlas/indexer";
import type { AtlasSourceDiffProvider } from "@atlas/mcp";
import { type AtlasStoreClient, openStore, RepoRepository } from "@atlas/store";

import type { ServerEnv } from "../env";
import { BuildOperationsService } from "./build-operations.service";
import { McpBridgeService } from "./mcp-bridge.service";
import { RetrievalHttpService } from "./retrieval-http.service";
import { RemoteSecurityService } from "./remote-security.service";
import { StoreReadService } from "./store-read.service";
import type { AtlasServerDependencies } from "./types";

const SERVER_SERVICES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_SERVICES_DIR, "..", "..", "..", "..");

/** Builds the explicit server dependency graph from validated env and ATLAS config. */
export async function buildServerDependencies(
  env: ServerEnv,
  config?: ResolvedAtlasConfig,
): Promise<AtlasServerDependencies> {
  const resolvedConfig = config ?? (await loadConfig({ cwd: REPO_ROOT }));
  const opened = await openServerStore(env, resolvedConfig.config.corpusDbPath);
  const db = opened.db;
  const runtime = createConfigBoundServices(env, resolvedConfig, db);
  const dependencies: AtlasServerDependencies = {
    env: {
      ...env,
      host: env.host,
      port: env.port,
    },
    config: resolvedConfig,
    db,
    ...(opened.ownedDbDir === undefined
      ? {}
      : { ownedDbDir: opened.ownedDbDir }),
    store: new StoreReadService(db),
    retrieval: new RetrievalHttpService(db),
    remoteSecurity: new RemoteSecurityService(env, () =>
      new RepoRepository(db).list().map((repo) => repo.repoId),
    ),
    operations: runtime.operations,
    ...(runtime.mcp === undefined
      ? {}
      : { mcp: runtime.mcp, mcpServer: runtime.mcp.atlasMcpServer }),
    reloadConfig(nextConfig) {
      const previousMcp = dependencies.mcp;
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
      if (previousMcp !== undefined && previousMcp !== nextRuntime.mcp) {
        void previousMcp.close();
      }
    },
  };
  return dependencies;
}

async function openServerStore(
  env: ServerEnv,
  corpusDbPath: string,
): Promise<{ db: AtlasStoreClient; ownedDbDir?: string }> {
  const source = openStore({ path: corpusDbPath, migrate: true });
  if (env.remote?.enabled !== true) return { db: source };
  const ownedDbDir = await mkdtemp(join(tmpdir(), "atlas-remote-corpus-"));
  const snapshotPath = join(ownedDbDir, "corpus.db");
  try {
    source.run("VACUUM INTO $snapshotPath", { $snapshotPath: snapshotPath });
  } catch (error) {
    await rm(ownedDbDir, { recursive: true, force: true });
    throw error;
  } finally {
    source.close();
  }
  let snapshot: AtlasStoreClient | undefined;
  try {
    snapshot = openStore({ path: snapshotPath, readOnly: true });
    assertRemoteCorpusPayloadBounds(snapshot, env.remote.maxResponseBytes);
    return { db: snapshot, ownedDbDir };
  } catch (error) {
    snapshot?.close();
    await rm(ownedDbDir, { recursive: true, force: true });
    throw error;
  }
}

function assertRemoteCorpusPayloadBounds(
  db: AtlasStoreClient,
  maxResponseBytes: number,
): void {
  // JSON escaping can expand one input byte to six output bytes. Reserve
  // additional envelope space so no single persisted value can allocate an
  // oversized remote response before middleware serialization.
  const maxStoredBytes = Math.max(1_024, Math.floor(maxResponseBytes / 8));
  const checks = [
    {
      source: "section",
      sql: `SELECT MAX(
        length(CAST(text AS BLOB)) +
        length(CAST(code_blocks_json AS BLOB))
      ) AS bytes FROM sections`,
    },
    {
      source: "chunk",
      sql: "SELECT MAX(length(CAST(text AS BLOB))) AS bytes FROM chunks",
    },
    {
      source: "summary",
      sql: "SELECT MAX(length(CAST(text AS BLOB))) AS bytes FROM summaries",
    },
    {
      source: "skill artifact",
      sql: "SELECT MAX(size_bytes) AS bytes FROM skill_artifacts",
    },
  ] as const;
  for (const check of checks) {
    const bytes = db.get<{ bytes: number | null }>(check.sql)?.bytes ?? 0;
    if (bytes > maxStoredBytes)
      throw new Error(
        `Remote corpus ${check.source} payload is ${bytes} bytes; the safe per-value limit for ATLAS_REMOTE_MAX_RESPONSE_BYTES=${maxResponseBytes} is ${maxStoredBytes}. Split the source content or raise the response limit before hosting it.`,
      );
  }
}

function createConfigBoundServices(
  env: ServerEnv,
  config: ResolvedAtlasConfig,
  db: AtlasStoreClient,
): Pick<AtlasServerDependencies, "operations" | "mcp"> {
  const { deps: indexerDeps, service: indexer } = createIndexerServices({
    config,
    db,
  });
  const mcpIdentity = resolveIdentityProfile({
    envIdentityRoot: config.env.ATLAS_IDENTITY_ROOT,
    configIdentity: config.config.identity,
    mcp: {
      envMcpName: config.env.ATLAS_MCP_NAME,
      envMcpTitle: config.env.ATLAS_MCP_TITLE,
      envMcpResourcePrefix: config.env.ATLAS_MCP_RESOURCE_PREFIX,
    },
  }).mcpIdentity;
  const mcp = env.enableMcp
    ? new McpBridgeService(
        db,
        env.remote?.enabled === true
          ? undefined
          : createSourceDiffProvider(indexerDeps),
        mcpIdentity,
        env.discoveryPolicy,
      )
    : undefined;
  return {
    operations: new BuildOperationsService(indexer),
    ...(mcp === undefined ? {} : { mcp }),
  };
}

function createSourceDiffProvider(
  indexerDeps: IndexerDependencies,
): AtlasSourceDiffProvider {
  return {
    async diff(request) {
      const repo = indexerDeps.resolveRepo(request.repoId);
      const diff = await computeSourceDiff(
        repo,
        indexerDeps,
        request.fromRevision,
        request.toRevision,
      );
      return {
        repoId: diff.repoId,
        fromRevision: request.fromRevision,
        toRevision: request.toRevision,
        changes: diff.changes,
        relevantChanges: diff.relevantChanges,
        relevantDocPaths: diff.relevantDocPaths,
        topologySensitivePaths: diff.topologySensitivePaths,
        packageManifestPaths: diff.packageManifestPaths,
        ...(diff.fullRebuildRequired === undefined
          ? {}
          : { fullRebuildRequired: diff.fullRebuildRequired }),
        ...(diff.fullRebuildReason === undefined
          ? {}
          : { fullRebuildReason: diff.fullRebuildReason }),
      };
    },
  };
}

/** Closes server resources owned by dependencies. */
export async function closeServerDependencies(
  dependencies: Pick<AtlasServerDependencies, "db" | "mcp" | "ownedDbDir">,
): Promise<void> {
  if (dependencies.mcp !== undefined) await dependencies.mcp.close();
  dependencies.db.close();
  if (dependencies.ownedDbDir !== undefined)
    await rm(dependencies.ownedDbDir, { recursive: true, force: true });
}

export type { AtlasStoreClient, ResolvedAtlasConfig };
