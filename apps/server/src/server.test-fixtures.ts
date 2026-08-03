import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ResolvedAtlasConfig,
  resolveRuntimeRepoConfigs,
} from "@atlas/config";
import {
  type CanonicalDocument,
  type CorpusChunk,
  createChunkId,
  createDocId,
  createModuleId,
  createPackageId,
  createSectionId,
  createSkillId,
} from "@atlas/core";
import type {
  BuildBatchReport,
  BuildReport,
  IndexerService,
  SyncBatchReport,
  SyncReport,
} from "@atlas/indexer";
import {
  type AtlasStoreClient,
  ChunkRepository,
  DocRepository,
  ManifestRepository,
  ModuleRepository,
  openStore,
  PackageRepository,
  RepoRepository,
  SkillRepository,
  SummaryRepository,
} from "@atlas/store";

import { createApp } from "./app";
import type { ServerEnv } from "./env";
import { BuildOperationsService } from "./services/build-operations.service";
import { McpBridgeService } from "./services/mcp-bridge.service";
import { RemoteSecurityService } from "./services/remote-security.service";
import { RetrievalHttpService } from "./services/retrieval-http.service";
import { StoreReadService } from "./services/store-read.service";
import type { AtlasServerDependencies } from "./services/types";

export const repoId = "atlas";
export const packageId = createPackageId({ repoId, path: "packages/auth" });
export const moduleId = createModuleId({
  repoId,
  packageId,
  path: "packages/auth/src/session",
});
export const docId = createDocId({
  repoId,
  path: "packages/auth/docs/session.md",
});
export const sectionId = createSectionId({
  docId,
  headingPath: ["Session", "Rotation"],
  ordinal: 0,
});
export const skillId = createSkillId({
  repoId,
  packageId,
  moduleId,
  path: "packages/auth/docs/session-skill.md",
});

type McpIdentity = {
  name?: string;
  title?: string;
  resourcePrefix?: string;
};

export interface ServerTestApp {
  handle(request: Request): Promise<Response>;
}

export interface ServerTestFixture {
  dbPath: string;
  store: AtlasStoreClient;
  app: ServerTestApp;
  createDependencies(
    envOverrides?: Partial<ServerEnv>,
    indexer?: IndexerService,
    configPath?: string,
    mcpIdentity?: McpIdentity,
  ): AtlasServerDependencies;
  destroy(): Promise<void>;
}

export async function createServerTestFixture(): Promise<ServerTestFixture> {
  const dbPath = join(
    await mkdtemp(join(tmpdir(), "atlas-server-test-")),
    "atlas.db",
  );
  const store = openStore({ path: dbPath, migrate: true });
  const dependencies = new Set<AtlasServerDependencies>();
  const createFixtureDependencies = (
    envOverrides: Partial<ServerEnv> = {},
    indexer: IndexerService = createStubIndexer(),
    configPath = "/tmp/atlas.config.json",
    mcpIdentity?: McpIdentity,
  ): AtlasServerDependencies => {
    const fixtureDependencies = createDependencies(
      store,
      dbPath,
      envOverrides,
      indexer,
      configPath,
      mcpIdentity,
    );
    dependencies.add(fixtureDependencies);
    return fixtureDependencies;
  };
  seedStore(store);
  const app = createApp(createFixtureDependencies());

  return {
    dbPath,
    store,
    app,
    createDependencies: createFixtureDependencies,
    async destroy() {
      try {
        await Promise.all(
          [...dependencies].map((dependency) => dependency.mcp?.close()),
        );
      } finally {
        store.close();
        await rm(dbPath.replace(/\/atlas\.db$/, ""), {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

export async function json(app: ServerTestApp, path: string): Promise<unknown> {
  return response(app, path).then((res) => res.json());
}

export async function postJson(
  app: ServerTestApp,
  path: string,
  body: unknown,
): Promise<unknown> {
  return response(app, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => res.json());
}

export function mcpRequest(
  app: ServerTestApp,
  body: { id: number; method: string; params?: unknown },
  sessionId?: string | undefined,
  headers: Record<string, string> = {},
): Promise<Response> {
  return response(app, "/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26",
      ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
  });
}

export function response(
  app: ServerTestApp,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return app.handle(new Request(`http://atlas.local${path}`, init));
}

export function corsPreflight(
  app: ServerTestApp,
  origin: string,
): Promise<Response> {
  return app.handle(
    new Request("http://atlas.local/api/search/scopes", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    }),
  );
}

export function createDependencies(
  store: AtlasStoreClient,
  corpusDbPath: string,
  envOverrides: Partial<ServerEnv> = {},
  indexer: IndexerService = createStubIndexer(),
  configPath = "/tmp/atlas.config.json",
  mcpIdentity?:
    | { name?: string; title?: string; resourcePrefix?: string }
    | undefined,
): AtlasServerDependencies {
  const env: ServerEnv = {
    host: "127.0.0.1",
    port: 3000,
    enableUi: false,
    enableOpenApi: false,
    enableMcp: false,
    enableTelemetry: false,
    discoveryPolicy: "neutral",
    logRequests: false,
    ...envOverrides,
  };
  const mcp = env.enableMcp
    ? new McpBridgeService(store, undefined, mcpIdentity)
    : undefined;
  const dependencies: AtlasServerDependencies = {
    env,
    config: createResolvedConfig(corpusDbPath, configPath),
    db: store,
    store: new StoreReadService(store),
    retrieval: new RetrievalHttpService(store),
    operations: new BuildOperationsService(indexer),
    ...(mcp === undefined ? {} : { mcp, mcpServer: mcp.atlasMcpServer }),
    remoteSecurity: new RemoteSecurityService(env, () =>
      new RepoRepository(store).list().map((repo) => repo.repoId),
    ),
    reloadConfig(nextConfig) {
      dependencies.config = nextConfig;
      dependencies.operations = new BuildOperationsService(indexer);
    },
  };
  return dependencies;
}

export function remoteHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-forwarded-proto": "https",
  };
}

export function createStubIndexer(
  overrides: Partial<IndexerService> = {},
): IndexerService {
  return {
    async syncRepo(): Promise<SyncReport> {
      throw new Error("stub");
    },
    async syncAll(): Promise<SyncBatchReport> {
      throw new Error("stub");
    },
    async buildRepo(): Promise<BuildReport> {
      throw new Error("stub");
    },
    async buildAll(): Promise<BuildBatchReport> {
      throw new Error("stub");
    },
    ...overrides,
  };
}

export function fakeTimings() {
  return {
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.010Z",
    durationMs: 10,
  };
}

export function fakeRecovery() {
  return {
    previousCorpusPreserved: true,
    stale: false,
    nextAction: "No recovery action required.",
  };
}

export function createResolvedConfig(
  corpusDbPath: string,
  configPath = "/tmp/atlas.config.json",
): ResolvedAtlasConfig {
  const config: ResolvedAtlasConfig["config"] = {
    version: 1,
    cacheDir: corpusDbPath.replace(/\/atlas\.db$/, ""),
    corpusDbPath,
    logLevel: "info",
    server: { transport: "http", host: "127.0.0.1", port: 3000 },
    hosts: [
      {
        name: "github.com",
        webUrl: "https://github.com",
        apiUrl: "https://api.github.com",
        protocol: "ssh",
        priority: 100,
        default: true,
      },
    ],
    docs: { metadata: { rules: [], profiles: {} } },
    repos: [
      {
        repoId,
        mode: "local-git",
        git: {
          remote: "file:///tmp/atlas",
          localPath: "/tmp/atlas",
          ref: "main",
          refMode: "remote",
        },
        workspace: {
          packageGlobs: ["packages/*"],
          packageManifestFiles: ["package.json"],
        },
        topology: [
          {
            id: "docs",
            kind: "module-doc",
            match: { include: ["**/*.md"] },
            ownership: { attachTo: "module" },
            authority: "preferred",
            priority: 1,
          },
        ],
      },
    ],
  };
  return {
    config,
    runtimeRepos: resolveRuntimeRepoConfigs(config, configPath),
    source: { configPath, loadedFrom: "explicit" },
    env: {},
  };
}

function seedStore(store: AtlasStoreClient): void {
  new RepoRepository(store).upsert({
    repoId,
    mode: "local-git",
    revision: "rev_1",
  });
  new ManifestRepository(store).upsert({
    repoId,
    indexedRevision: "rev_1",
    compilerVersion: "compiler-v1",
  });
  new PackageRepository(store).upsert({
    packageId,
    repoId,
    name: "@atlas/auth",
    path: "packages/auth",
    manifestPath: "packages/auth/package.json",
  });
  new ModuleRepository(store).upsert({
    moduleId,
    repoId,
    packageId,
    name: "session",
    path: "packages/auth/src/session",
  });
  new DocRepository(store).replaceCanonicalDocument(createDocument());
  new SummaryRepository(store).replaceForTarget("document", docId, [
    {
      summaryId: `${docId}:summary`,
      targetType: "document",
      targetId: docId,
      level: "short",
      text: "Session docs explain token rotation.",
      tokenCount: 8,
    },
  ]);
  new ChunkRepository(store).replaceForDocument(docId, [createChunk()]);
  new SkillRepository(store).upsert({
    node: {
      skillId,
      repoId,
      packageId,
      moduleId,
      path: "packages/auth/docs/session-skill.md",
      title: "Session Skill",
      sourceDocPath: "packages/auth/docs/session.md",
      topics: ["session"],
      aliases: ["session rotation"],
      tokenCount: 18,
      diagnostics: [],
    },
    sourceDocId: docId,
    description: "Use this skill to answer session token operation questions.",
    headings: [["Session", "Rotation"]],
    keySections: [
      "Rotate session tokens by calling rotateSessionToken during renewal.",
    ],
    topics: ["session"],
    aliases: ["session rotation"],
    tokenCount: 18,
  });
}

function createDocument(): CanonicalDocument {
  return {
    docId,
    repoId,
    path: "packages/auth/docs/session.md",
    sourceVersion: "rev_1",
    title: "Session",
    kind: "module-doc",
    authority: "preferred",
    scopes: [{ level: "module", repoId, packageId, moduleId }],
    sections: [
      {
        sectionId,
        headingPath: ["Session", "Rotation"],
        ordinal: 0,
        text: "Rotate session tokens by calling rotateSessionToken during renewal.",
        codeBlocks: [{ lang: "ts", code: "rotateSessionToken(sessionId);" }],
      },
    ],
    metadata: {
      packageId,
      moduleId,
      tags: ["session"],
    },
  };
}

function createChunk(): CorpusChunk {
  return {
    chunkId: createChunkId({ docId, sectionId, ordinal: 0 }),
    docId,
    repoId,
    packageId,
    moduleId,
    kind: "module-doc",
    authority: "preferred",
    headingPath: ["Session", "Rotation"],
    ordinal: 0,
    text: "Rotate session tokens by calling rotateSessionToken during renewal.",
    tokenCount: 12,
  };
}
