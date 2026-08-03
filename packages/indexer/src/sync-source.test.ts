import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeSourceDiff, createIndexerServices } from "@atlas/indexer";

import {
  createIndexerTestFixture,
  createTestResolvedConfig,
  disposeIndexerTestFixture,
  git,
  gitOutput,
  repoId,
  type IndexerTestFixture,
} from "./indexer.test-helpers";

describe("sync and source behavior", () => {
  let fixture: IndexerTestFixture;
  let originPath: string;
  let localPath: string;
  let store: IndexerTestFixture["store"];

  beforeEach(async () => {
    fixture = await createIndexerTestFixture();
    ({ originPath, localPath, store } = fixture);
  });

  afterEach(async () => {
    await disposeIndexerTestFixture(fixture);
  });

  test("syncs revisions, reports unchanged state, and then reports updated doc changes", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const initial = await service.syncRepo(repoId);
    expect(initial).toMatchObject({
      repoId,
      status: "unchanged",
      sourceChanged: false,
      corpusAffected: true,
      corpusImpact: "missing-manifest",
      changedPathCount: 0,
      relevantChangedPathCount: 0,
      recovery: {
        previousCorpusPreserved: true,
        stale: true,
        nextAction: "Run atlas build to create the indexed corpus.",
      },
    });
    expect(initial.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "fetch_completed",
    );
    expect(deps.store.repos.get(repoId)?.revision).toBe(
      initial.currentRevision,
    );

    const unchanged = await service.syncRepo(repoId);
    expect(unchanged.status).toBe("unchanged");

    await writeFile(
      join(originPath, "packages", "auth", "docs", "api.md"),
      "# API\n\nUpdated package documentation.\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "update package doc"]);

    const updated = await service.syncRepo(repoId);
    expect(updated).toMatchObject({
      repoId,
      status: "updated",
      sourceChanged: true,
      corpusAffected: true,
      corpusImpact: "missing-manifest",
      changedPathCount: 1,
      relevantChangedPathCount: 1,
      relevantDocPathCount: 1,
      recovery: {
        previousCorpusPreserved: true,
        stale: true,
        nextAction: "Run atlas build to create the indexed corpus.",
      },
    });
  });

  test("sync fast-forwards compatible manifests for code-only changes", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const built = await service.buildRepo(repoId);
    await mkdir(join(originPath, "packages", "auth", "src"), {
      recursive: true,
    });
    await writeFile(
      join(originPath, "packages", "auth", "src", "index.ts"),
      "export const updated = true;\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "update code only"]);

    const synced = await service.syncRepo(repoId);

    expect(synced).toMatchObject({
      repoId,
      status: "updated",
      sourceChanged: true,
      corpusAffected: false,
      corpusImpact: "none",
      changedPathCount: 1,
      relevantChangedPathCount: 0,
      relevantDocPathCount: 0,
      recovery: {
        previousCorpusPreserved: true,
        stale: false,
        nextAction: "No recovery action required.",
      },
    });
    expect(deps.store.repos.get(repoId)?.revision).toBe(synced.currentRevision);
    expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
      synced.currentRevision,
    );
    expect(deps.store.manifests.get(repoId)?.indexedRevision).not.toBe(
      built.currentRevision,
    );
  });

  test("sync keeps compatible manifests stale for documentation changes", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const built = await service.buildRepo(repoId);
    await writeFile(
      join(originPath, "packages", "auth", "docs", "api.md"),
      "# API\n\nSync-visible package documentation update.\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "update docs after build"]);

    const synced = await service.syncRepo(repoId);

    expect(synced).toMatchObject({
      repoId,
      status: "updated",
      sourceChanged: true,
      corpusAffected: true,
      corpusImpact: "docs",
      changedPathCount: 1,
      relevantChangedPathCount: 1,
      relevantDocPathCount: 1,
      recovery: {
        previousCorpusPreserved: true,
        stale: true,
        nextAction: "Run atlas build to update the indexed corpus.",
      },
    });
    expect(deps.store.repos.get(repoId)?.revision).toBe(synced.currentRevision);
    expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
      built.currentRevision,
    );
  });

  test("repeated sync preserves corpus-affecting changes until build consumes them", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const built = await service.buildRepo(repoId);
    await writeFile(
      join(originPath, "packages", "auth", "docs", "api.md"),
      "# API\n\nRepeated sync should stay stale.\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "doc update before repeated sync"]);

    const firstSync = await service.syncRepo(repoId);
    expect(firstSync).toMatchObject({
      sourceChanged: true,
      corpusAffected: true,
      corpusImpact: "docs",
      relevantDocPathCount: 1,
    });
    expect(deps.store.repos.get(repoId)?.revision).toBe(
      firstSync.currentRevision,
    );
    expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
      built.currentRevision,
    );

    const secondSync = await service.syncRepo(repoId);
    expect(secondSync).toMatchObject({
      sourceChanged: false,
      corpusAffected: true,
      corpusImpact: "docs",
      relevantDocPathCount: 1,
    });
    expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
      built.currentRevision,
    );

    const rebuild = await service.buildRepo(repoId);
    expect(rebuild).toMatchObject({
      strategy: "incremental",
      docsRebuilt: 1,
      manifestUpdated: true,
    });
    expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
      rebuild.currentRevision,
    );
  });

  test("computes explicit source diffs without mutating stored repo revision", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const initial = await service.syncRepo(repoId);
    await writeFile(
      join(originPath, "packages", "auth", "docs", "api.md"),
      "# API\n\nRead-only source diff update.\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "read-only diff update"]);
    const nextRevision = await gitOutput(originPath, ["rev-parse", "HEAD"]);
    if (initial.currentRevision === undefined) {
      throw new Error("Initial sync did not report a current revision.");
    }

    const diff = await computeSourceDiff(
      deps.resolveRepo(repoId),
      deps,
      initial.currentRevision,
      nextRevision,
    );

    expect(diff).toMatchObject({
      repoId,
      previousRevision: initial.currentRevision,
      currentRevision: nextRevision,
      changed: true,
      relevantDocPaths: ["packages/auth/docs/api.md"],
      relevantChanges: [
        expect.objectContaining({
          path: "packages/auth/docs/api.md",
          normalizedKind: "modified",
        }),
      ],
    });
    expect(deps.store.repos.get(repoId)?.revision).toBe(
      initial.currentRevision,
    );
  });
});
