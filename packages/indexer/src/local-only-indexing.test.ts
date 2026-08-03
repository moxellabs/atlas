import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeDocumentationSignal,
  createIndexerServices,
} from "@atlas/indexer";

import {
  createIndexerTestFixture,
  createTestResolvedConfig,
  disposeIndexerTestFixture,
  git,
  moduleDocId,
  moduleId,
  packageDocId,
  packageId,
  repoDocId,
  repoId,
  skillDocId,
  type IndexerTestFixture,
} from "./indexer.test-helpers";

describe("documentation signal", () => {
  test("detects README-only documentation", async () => {
    const signal = await analyzeDocumentationSignal(
      ["README.md"],
      async () => "hello",
    );
    expect(signal.signal).toBe("readme-only");
    expect(signal.warnings[0]?.code).toBe("README_ONLY_DOCS");
  });

  test("detects weak markdown corpus", async () => {
    const signal = await analyzeDocumentationSignal(
      ["docs/a.md", "docs/b.mdx"],
      async () => "small",
    );
    expect(signal.signal).toBe("weak");
    expect(signal.warnings[0]?.code).toBe("WEAK_DOCS_SIGNAL");
  });

  test("detects strong markdown corpus", async () => {
    const content = "x".repeat(700);
    const signal = await analyzeDocumentationSignal(
      ["docs/a.md", "docs/b.md", "docs/c.mdx"],
      async () => content,
    );
    expect(signal.signal).toBe("strong");
    expect(signal.markdownFileCount).toBe(3);
    expect(signal.totalMarkdownBytes).toBeGreaterThanOrEqual(2000);
  });
});

describe("local-only indexing", () => {
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

  test("runs an initial full build and persists canonical docs, skills, and manifest state", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const report = await service.buildRepo(repoId);

    expect(report).toMatchObject({
      repoId,
      strategy: "full",
      partial: false,
      docsRebuilt: 4,
      manifestUpdated: true,
      recovery: {
        previousCorpusPreserved: true,
        stale: false,
      },
    });
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "fetch_completed",
    );
    expect(
      deps.store.docs
        .listByRepo(repoId)
        .map((doc) => doc.docId)
        .sort(),
    ).toEqual([moduleDocId, skillDocId, repoDocId, packageDocId].sort());
    expect(deps.store.skills.listByRepo(repoId)).toEqual([
      expect.objectContaining({
        topics: ["auth", "login"],
        aliases: ["auth helper", "login helper"],
        tokenCount: expect.any(Number),
      }),
    ]);
    expect(
      deps.store.skills.summarizeArtifacts(
        deps.store.skills.listByRepo(repoId)[0]?.skillId ?? "",
      ),
    ).toEqual({
      scripts: 1,
      references: 1,
      agentProfiles: 1,
      other: 0,
    });
    expect(deps.store.manifests.get(repoId)).toMatchObject({
      repoId,
      indexedRevision: report.currentRevision,
      compilerVersion: deps.compilerVersion,
      schemaVersion: deps.storeSchemaVersion,
    });
  });

  test("rebuilds incrementally for doc edits and cleans up deleted documents", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    await service.buildRepo(repoId);

    await writeFile(
      join(originPath, "packages", "auth", "docs", "api.md"),
      "# API\n\nIncremental update.\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "incremental doc edit"]);

    const incremental = await service.buildRepo(repoId);
    expect(incremental).toMatchObject({
      repoId,
      strategy: "incremental",
      partial: false,
      docsRebuilt: 1,
      docsDeleted: 0,
      manifestUpdated: true,
    });
    expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
      incremental.currentRevision,
    );

    await unlink(join(originPath, "packages", "auth", "docs", "api.md"));
    await git(originPath, ["add", "-A"]);
    await git(originPath, ["commit", "-m", "delete package doc"]);

    const deletion = await service.buildRepo(repoId);
    expect(deletion).toMatchObject({
      repoId,
      strategy: "incremental",
      partial: false,
      docsDeleted: 1,
      manifestUpdated: true,
    });
    expect(deps.store.docs.get(packageDocId)).toBeUndefined();
  });

  test("rebuilds skill bundles when adjacent scripts change", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    await service.buildRepo(repoId);
    const skill = deps.store.skills.listByRepo(repoId)[0];
    if (skill === undefined) {
      throw new Error("Expected seeded skill.");
    }
    const before = deps.store.skills.getArtifact(
      skill.skillId,
      "scripts/check.py",
    );

    await writeFile(
      join(originPath, "Auth", "docs", "auth-skill", "scripts", "check.py"),
      "print('changed')\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "update skill script"]);

    const report = await service.buildRepo(repoId);
    expect(report).toMatchObject({
      repoId,
      strategy: "full",
      docsRebuilt: 4,
      skillsUpdated: 1,
    });
    expect(
      deps.store.skills.getArtifact(skill.skillId, "scripts/check.py"),
    ).toMatchObject({
      path: "scripts/check.py",
      content: "print('changed')\n",
    });
    expect(
      deps.store.skills.getArtifact(skill.skillId, "scripts/check.py")
        ?.contentHash,
    ).not.toBe(before?.contentHash);
  });

  test("supports targeted doc, package, and module builds with partial manifest state", async () => {
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const byDoc = await service.buildRepo(repoId, {
      selection: { docIds: [moduleDocId] },
    });
    expect(byDoc).toMatchObject({
      repoId,
      strategy: "targeted",
      partial: true,
      docsRebuilt: 1,
      manifestUpdated: true,
    });
    expect(deps.store.manifests.get(repoId)).toMatchObject({
      repoId,
      partialRevision: byDoc.currentRevision,
      partialSelector: { docIds: [moduleDocId] },
    });
    expect(deps.store.manifests.get(repoId)?.indexedRevision).toBeUndefined();

    const byPackage = await service.buildRepo(repoId, {
      selection: { packageId },
    });
    expect(byPackage).toMatchObject({
      repoId,
      strategy: "targeted",
      partial: true,
      docsRebuilt: 1,
    });
    expect(deps.store.manifests.get(repoId)?.partialSelector).toEqual({
      packageId,
    });

    const byModule = await service.buildRepo(repoId, {
      selection: { moduleId },
    });
    expect(byModule.repoId).toBe(repoId);
    expect(byModule.strategy).toBe("targeted");
    expect(byModule.partial).toBe(true);
    expect(byModule.docsRebuilt).toBeGreaterThanOrEqual(1);
    expect(deps.store.manifests.get(repoId)?.partialSelector).toEqual({
      moduleId,
    });

    const full = await service.buildRepo(repoId, { force: true });
    expect(full.strategy).toBe("full");
    expect(full.partial).toBe(false);
    expect(deps.store.manifests.get(repoId)).toMatchObject({
      repoId,
      indexedRevision: full.currentRevision,
    });
    expect(deps.store.manifests.get(repoId)).not.toMatchObject({
      partialRevision: expect.any(String),
      partialSelector: expect.anything(),
    });
  });

  test("reports post-discovery compile failures with selected docs and no partial persistence", async () => {
    await writeFile(
      join(originPath, "docs", "broken.md"),
      "---\ntitle: Broken\n# Missing closing frontmatter\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "add broken frontmatter doc"]);
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const failed = await service.buildRepo(repoId);

    expect(failed).toMatchObject({
      repoId,
      manifestUpdated: false,
      docsConsidered: 5,
      docsRebuilt: 0,
      recovery: {
        previousCorpusPreserved: true,
        nextAction:
          "Fix the build failure and rerun atlas build for this repo.",
      },
    });
    expect(failed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          stage: "compile",
          path: "docs/broken.md",
          cause: expect.objectContaining({
            message: expect.stringContaining("docs/broken.md"),
            cause: expect.objectContaining({
              message: expect.stringContaining("Frontmatter opening marker"),
            }),
          }),
        }),
      ]),
    );
    expect(deps.store.docs.listByRepo(repoId)).toEqual([]);
    expect(deps.store.manifests.get(repoId)).toBeUndefined();
  });

  test("ignores generated and vendored docs during local-git builds", async () => {
    await mkdir(join(originPath, "node_modules", "bad-package"), {
      recursive: true,
    });
    await mkdir(join(originPath, ".moxel", "atlas"), { recursive: true });
    await writeFile(
      join(originPath, "node_modules", "bad-package", "SKILL.md"),
      "---\ndescription: broken\n# Missing closing frontmatter\n",
    );
    await writeFile(
      join(originPath, ".moxel", "atlas", "SKILL.md"),
      "---\ndescription: generated broken\n# Missing closing frontmatter\n",
    );
    await git(originPath, ["add", "."]);
    await git(originPath, ["commit", "-m", "add generated ignored docs"]);
    const { service, deps } = createIndexerServices({
      config: createTestResolvedConfig({
        originPath: originPath,
        localPath: localPath,
      }),
      db: store,
    });

    const report = await service.buildRepo(repoId);

    expect(report).toMatchObject({
      repoId,
      manifestUpdated: true,
      docsConsidered: 4,
      docsRebuilt: 4,
    });
    expect(
      deps.store.docs.listByRepo(repoId).map((doc) => doc.path),
    ).not.toEqual(
      expect.arrayContaining([
        "node_modules/bad-package/SKILL.md",
        ".moxel/atlas/SKILL.md",
      ]),
    );
  });
});
