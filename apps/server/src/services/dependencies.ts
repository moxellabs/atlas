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
  createIndexerServices,
  RepositoryLifecycleService,
} from "@atlas/indexer";
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
    ...(runtime.lifecycle === undefined
      ? {}
      : { lifecycle: runtime.lifecycle }),
    reloadConfig(nextConfig) {
      const previousMcp = dependencies.mcp;
      const previousLifecycle = dependencies.lifecycle;
      const nextRuntime = createConfigBoundServices(env, nextConfig, db);
      dependencies.config = nextConfig;
      dependencies.operations = nextRuntime.operations;
      dependencies.lifecycle = nextRuntime.lifecycle;
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
      if (
        previousLifecycle !== undefined &&
        previousLifecycle !== nextRuntime.lifecycle
      ) {
        void previousLifecycle.close();
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
  // envelope and aggregate-row space before any remote response is built.
  const checks = [
    {
      source: "section",
      sql: `SELECT MAX(
        length(CAST(text AS BLOB)) +
        length(CAST(code_blocks_json AS BLOB))
      ) AS bytes FROM sections`,
      divisor: 8,
    },
    {
      source: "chunk",
      sql: "SELECT MAX(length(CAST(text AS BLOB))) AS bytes FROM chunks",
      divisor: 8,
    },
    {
      source: "summary",
      sql: "SELECT MAX(length(CAST(text AS BLOB))) AS bytes FROM summaries",
      divisor: 8,
    },
    {
      source: "skill artifact",
      sql: `SELECT MAX(
        MAX(size_bytes, COALESCE(length(CAST(content AS BLOB)), 0))
      ) AS bytes FROM skill_artifacts`,
      divisor: 8,
    },
    {
      source: "document metadata",
      sql: `SELECT MAX(
        length(CAST(path AS BLOB)) +
        COALESCE(length(CAST(title AS BLOB)), 0) +
        COALESCE(length(CAST(description AS BLOB)), 0) +
        length(CAST(tags_json AS BLOB)) +
        length(CAST(audience_json AS BLOB)) +
        length(CAST(purpose_json AS BLOB))
      ) AS bytes FROM documents`,
      divisor: 256,
    },
    {
      source: "repository metadata",
      sql: `SELECT MAX(
        length(CAST(repo_id AS BLOB)) +
        length(CAST(revision AS BLOB))
      ) AS bytes FROM repos`,
      divisor: 256,
    },
    {
      source: "package metadata",
      sql: `SELECT MAX(
        length(CAST(name AS BLOB)) +
        length(CAST(path AS BLOB)) +
        length(CAST(manifest_path AS BLOB))
      ) AS bytes FROM packages`,
      divisor: 256,
    },
    {
      source: "module metadata",
      sql: `SELECT MAX(
        length(CAST(name AS BLOB)) +
        length(CAST(path AS BLOB))
      ) AS bytes FROM modules`,
      divisor: 256,
    },
    {
      source: "skill metadata",
      sql: `SELECT MAX(
        length(CAST(source_doc_path AS BLOB)) +
        COALESCE(length(CAST(title AS BLOB)), 0) +
        COALESCE(length(CAST(description AS BLOB)), 0) +
        length(CAST(headings_json AS BLOB)) +
        length(CAST(key_sections_json AS BLOB)) +
        length(CAST(topics_json AS BLOB)) +
        length(CAST(aliases_json AS BLOB))
      ) AS bytes FROM skills`,
      divisor: 256,
    },
    {
      source: "manifest metadata",
      sql: `SELECT MAX(
        COALESCE(length(CAST(indexed_revision AS BLOB)), 0) +
        COALESCE(length(CAST(partial_selector_json AS BLOB)), 0) +
        COALESCE(length(CAST(compiler_version AS BLOB)), 0)
      ) AS bytes FROM manifests`,
      divisor: 256,
    },
  ] as const;
  for (const check of checks) {
    const bytes = db.get<{ bytes: number | null }>(check.sql)?.bytes ?? 0;
    const maxStoredBytes = Math.max(
      1_024,
      Math.floor(maxResponseBytes / check.divisor),
    );
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
): Pick<AtlasServerDependencies, "operations" | "mcp" | "lifecycle"> {
  const { service: indexer } = createIndexerServices({
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
  let mcp: McpBridgeService | undefined;
  const lifecycle =
        env.remote?.enabled === true
          ? undefined
      : new RepositoryLifecycleService({
          config,
          indexer,
          onCorpusChanged: () => {
            mcp?.refreshDiscovery();
          },
        });
  mcp = env.enableMcp
    ? new McpBridgeService(
        db,
        lifecycle,
        mcpIdentity,
        env.discoveryPolicy,
        env.remote?.enabled === true ? "bounded-remote" : "full",
      )
    : undefined;
  lifecycle?.start();
  return {
    operations: new BuildOperationsService(indexer),
    ...(mcp === undefined ? {} : { mcp }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
  };
}

/** Closes server resources owned by dependencies. */
export async function closeServerDependencies(
  dependencies: Pick<
    AtlasServerDependencies,
    "db" | "mcp" | "lifecycle" | "ownedDbDir"
  >,
): Promise<void> {
  if (dependencies.lifecycle !== undefined)
    await dependencies.lifecycle.close();
  if (dependencies.mcp !== undefined) await dependencies.mcp.close();
  dependencies.db.close();
  if (dependencies.ownedDbDir !== undefined)
    await rm(dependencies.ownedDbDir, { recursive: true, force: true });
}

export type { AtlasStoreClient, ResolvedAtlasConfig };
