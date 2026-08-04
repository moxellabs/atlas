import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  atlasConfigSchema,
  type ResolvedAtlasConfig,
  resolveRuntimeRepoConfigs,
} from "@atlas/config";
import { stableHash } from "@atlas/core";

import type { BuildReport, SyncReport } from "../types/indexer.types";
import {
  type RepositoryLifecycleDiagnostic,
  RepositoryLifecycleService,
} from "./repository-lifecycle.service";

const repoId = "github.com/moxellabs/atlas";
const temporaryRoots: string[] = [];

const timings = {
  startedAt: "2026-08-03T00:00:00.000Z",
  completedAt: "2026-08-03T00:00:00.001Z",
  durationMs: 1,
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("RepositoryLifecycleService", () => {
  test("refreshes due repositories, bounds change metadata, and honors persisted TTL state", async () => {
    const root = await temporaryRoot();
    const config = resolvedConfig(root);
    const changedPaths = Array.from(
      { length: 205 },
      (_, index) => `src/${String(204 - index).padStart(3, "0")}.ts`,
    );
    let syncCalls = 0;
    let buildCalls = 0;
    const changedStates: string[] = [];
    const service = new RepositoryLifecycleService({
      config,
      stateDir: join(root, "state"),
      now: () => Date.parse("2026-08-03T00:00:00.000Z"),
      indexer: {
        async syncRepo() {
          syncCalls += 1;
          return syncReport({ changedPaths });
        },
        async buildRepo() {
          buildCalls += 1;
          return buildReport();
        },
      },
      onCorpusChanged(_changedRepoId, state) {
        changedStates.push(state.status);
      },
    });

    await service.refreshDueRepositories();
    await service.refreshDueRepositories();

    expect(syncCalls).toBe(1);
    expect(buildCalls).toBe(1);
    expect(changedStates).toEqual(["fresh"]);
    expect(service.getRepositoryRefreshState(repoId)).toMatchObject({
      repoId,
      status: "fresh",
      sourceRevision: "rev-2",
      indexedRevision: "rev-2",
      lastCheckedAt: "2026-08-03T00:00:00.000Z",
    });
    expect(
      service.getRepositoryRefreshState(repoId)?.changedPaths,
    ).toHaveLength(200);
    expect(service.getRepositoryRefreshState(repoId)?.changedPaths.at(0)).toBe(
      "src/000.ts",
    );
    expect(service.getRepositoryRefreshState(repoId)?.changedPaths.at(-1)).toBe(
      "src/199.ts",
    );

    let restartedSyncCalls = 0;
    const restarted = new RepositoryLifecycleService({
      config,
      stateDir: join(root, "state"),
      now: () => Date.parse("2026-08-03T00:00:00.000Z"),
      indexer: {
        async syncRepo() {
          restartedSyncCalls += 1;
          return syncReport();
        },
        async buildRepo() {
          throw new Error("build must not run inside the persisted TTL");
        },
      },
    });
    await restarted.refreshDueRepositories();

    expect(restartedSyncCalls).toBe(0);
    expect(restarted.getRepositoryRefreshState(repoId)?.status).toBe("fresh");
  });

  test("skips scheduled work when disabled or bound to a current checkout", async () => {
    const root = await temporaryRoot();
    let syncCalls = 0;
    const indexer = {
      async syncRepo() {
        syncCalls += 1;
        return syncReport();
      },
      async buildRepo() {
        return buildReport();
      },
    };
    const disabled = new RepositoryLifecycleService({
      config: resolvedConfig(root, { enabled: false }),
      stateDir: join(root, "disabled-state"),
      indexer,
    });
    const currentCheckout = new RepositoryLifecycleService({
      config: resolvedConfig(root, { refMode: "current-checkout" }),
      stateDir: join(root, "checkout-state"),
      indexer,
    });

    await disabled.refreshDueRepositories();
    await currentCheckout.refreshDueRepositories();

    expect(syncCalls).toBe(0);
    expect(await currentCheckout.refreshRepository(repoId)).toBeUndefined();
  });

  test("preserves the last known-good corpus state when refresh fails", async () => {
    const root = await temporaryRoot();
    const config = resolvedConfig(root, { intervalMs: 1_000 });
    let now = Date.parse("2026-08-03T00:00:00.000Z");
    let shouldFail = false;
    const service = new RepositoryLifecycleService({
      config,
      stateDir: join(root, "state"),
      now: () => now,
      indexer: {
        async syncRepo() {
          if (shouldFail) throw new Error("remote unavailable");
          return syncReport({ changedPaths: ["docs/guide.md"] });
        },
        async buildRepo() {
          return buildReport();
        },
      },
    });

    await service.refreshDueRepositories();
    shouldFail = true;
    now += 1_001;
    await service.refreshDueRepositories();

    expect(service.getRepositoryRefreshState(repoId)).toMatchObject({
      status: "refresh_failed",
      sourceRevision: "rev-2",
      indexedRevision: "rev-2",
      lastSuccessfulRefreshAt: "2026-08-03T00:00:00.000Z",
      changedPaths: ["docs/guide.md"],
      error: { message: "remote unavailable" },
    });
  });

  test("coalesces refresh work across processes with a shared repository lock", async () => {
    const root = await temporaryRoot();
    const config = resolvedConfig(root);
    const stateDir = join(root, "state");
    let releaseSync!: () => void;
    let announceSync!: () => void;
    const syncStarted = new Promise<void>((resolve) => {
      announceSync = resolve;
    });
    const syncReleased = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    let secondProcessSyncCalls = 0;
    const first = new RepositoryLifecycleService({
      config,
      stateDir,
      indexer: {
        async syncRepo() {
          announceSync();
          await syncReleased;
          return syncReport({ corpusAffected: false, status: "unchanged" });
        },
        async buildRepo() {
          throw new Error("unchanged source must not build");
        },
      },
    });
    const second = new RepositoryLifecycleService({
      config,
      stateDir,
      indexer: {
        async syncRepo() {
          secondProcessSyncCalls += 1;
          return syncReport();
        },
        async buildRepo() {
          return buildReport();
        },
      },
    });

    const firstRefresh = first.refreshRepository(repoId);
    await syncStarted;
    const competingState = await second.refreshRepository(repoId);
    releaseSync();
    await firstRefresh;

    expect(secondProcessSyncCalls).toBe(0);
    expect(competingState?.status).toBe("refreshing");
    expect(first.getRepositoryRefreshState(repoId)?.status).toBe("fresh");
  });

  test("recovers an expired cross-process lock before refreshing", async () => {
    const root = await temporaryRoot();
    const config = resolvedConfig(root);
    const stateDir = join(root, "state");
    const lockPath = join(stateDir, `${stableHash(repoId)}.lock`);
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner"), "abandoned", "utf8");
    const expiredAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, expiredAt, expiredAt);
    const diagnostics: RepositoryLifecycleDiagnostic[] = [];
    let syncCalls = 0;
    const service = new RepositoryLifecycleService({
      config,
      stateDir,
      lockStaleMs: 1_000,
      indexer: {
        async syncRepo() {
          syncCalls += 1;
          return syncReport({ corpusAffected: false, status: "unchanged" });
        },
        async buildRepo() {
          throw new Error("unchanged source must not build");
        },
      },
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
      },
    });

    await service.refreshRepository(repoId);

    expect(syncCalls).toBe(1);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ type: "lock_recovered", repoId }),
    );
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "atlas-lifecycle-test-"));
  temporaryRoots.push(root);
  return root;
}

function resolvedConfig(
  root: string,
  options: {
    enabled?: boolean | undefined;
    intervalMs?: number | undefined;
    refMode?: "remote" | "current-checkout" | undefined;
  } = {},
): ResolvedAtlasConfig {
  const configPath = join(root, "atlas.config.json");
  const config = atlasConfigSchema.parse({
    version: 1,
    cacheDir: join(root, "cache"),
    corpusDbPath: join(root, "cache", "corpus.db"),
    logLevel: "warn",
    server: { transport: "stdio" },
    lifecycle: {
      repositoryRefresh: {
        enabled: options.enabled ?? true,
        intervalMs: options.intervalMs ?? 60_000,
      },
    },
    docs: { metadata: { rules: [], profiles: {} } },
    repos: [
      {
        repoId,
        mode: "local-git",
        git: {
          remote: "https://github.com/moxellabs/atlas.git",
          localPath: join(root, "repo"),
          ref: "main",
          refMode: options.refMode ?? "remote",
        },
        workspace: {
          packageGlobs: ["packages/*"],
          packageManifestFiles: ["package.json"],
        },
        topology: [
          {
            id: "docs",
            kind: "module-doc",
            match: { include: ["docs/**/*.md"] },
            ownership: { attachTo: "module" },
            authority: "preferred",
            priority: 1,
          },
        ],
      },
    ],
  });
  return {
    config,
    runtimeRepos: resolveRuntimeRepoConfigs(config, configPath),
    source: { configPath, loadedFrom: "explicit" },
    env: {} as ResolvedAtlasConfig["env"],
  };
}

function syncReport(overrides: Partial<SyncReport> = {}): SyncReport {
  const changedPaths = overrides.changedPaths ?? ["docs/guide.md"];
  const corpusAffected = overrides.corpusAffected ?? true;
  return {
    repoId,
    mode: "local-git",
    status: "updated",
    previousRevision: "rev-1",
    currentRevision: "rev-2",
    sourceChanged: true,
    corpusAffected,
    corpusImpact: corpusAffected ? "docs" : "none",
    changedPathCount: changedPaths.length,
    changedPaths,
    relevantChangedPathCount: changedPaths.length,
    relevantDocPathCount: changedPaths.length,
    topologySensitivePathCount: 0,
    packageManifestPathCount: 0,
    diagnostics: [],
    recovery: overrides.recovery ?? {
      previousCorpusPreserved: true,
      stale: corpusAffected,
      nextAction: corpusAffected
        ? "Build the corpus."
        : "No recovery action required.",
    },
    timings,
    ...overrides,
  };
}

function buildReport(): BuildReport {
  return {
    repoId,
    strategy: "incremental",
    reasonCode: "doc_changes",
    partial: false,
    reason: "Documentation changed.",
    currentRevision: "rev-2",
    docsConsidered: 1,
    docsRebuilt: 1,
    docsDeleted: 0,
    chunksPersisted: 1,
    skillsUpdated: 0,
    summariesUpdated: 1,
    manifestUpdated: true,
    changedPaths: ["docs/guide.md"],
    affectedDocPaths: ["docs/guide.md"],
    deletedDocPaths: [],
    skippedDocPaths: [],
    diagnostics: [],
    recovery: {
      previousCorpusPreserved: true,
      stale: false,
      nextAction: "No recovery action required.",
    },
    timings,
  };
}
