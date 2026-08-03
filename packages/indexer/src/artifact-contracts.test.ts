import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATLAS_VERSION } from "@atlas/core";
import { ManifestRepository, openStore, RepoRepository } from "@atlas/store";
import {
  buildArtifactManifest,
  buildDocsIndex,
  exportCorpusDbSnapshot,
  inspectMoxelAtlasArtifact,
  verifyMoxelAtlasArtifact,
  writeArtifactChecksums,
  writePrettyJson,
} from "@atlas/indexer";

describe("artifact contracts", () => {
  test("artifact freshness accepts valid artifacts and detects freshness", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-artifact-test-"));
    try {
      const artifactDir = await createArtifactFixture(root, {
        revision: "abc123",
      });
      const verified = await verifyMoxelAtlasArtifact({ artifactDir });
      expect(verified.valid).toBe(true);
      expect(verified.importable).toBe(true);
      expect(verified.manifest?.atlasVersion).toBe(ATLAS_VERSION);
      const fresh = await verifyMoxelAtlasArtifact({
        artifactDir,
        requireFresh: true,
        freshRef: "abc123",
      });
      expect(fresh.valid).toBe(true);
      expect(fresh.fresh).toBe(true);
      expect(fresh.expectedRevision).toBe("abc123");
      expect(fresh.indexedRevision).toBe("abc123");
      const stale = await verifyMoxelAtlasArtifact({
        artifactDir,
        requireFresh: true,
        freshRef: "def456",
      });
      expect(stale.valid).toBe(false);
      expect(stale.fresh).toBe(false);
      expect(stale.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "ATLAS_ARTIFACT_STALE",
      );
      const ignored = await verifyMoxelAtlasArtifact({
        artifactDir,
        freshRef: "def456",
      });
      expect(ignored.valid).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("artifact verify reports schema repo and corrupt corpus diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-artifact-test-"));
    try {
      const artifactDir = await createArtifactFixture(root, {
        revision: "abc123",
      });
      const manifestPath = join(artifactDir, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      await writePrettyJson(manifestPath, {
        ...manifest,
        schema: "bad",
        repoId: "bad",
      });
      await writeArtifactChecksums(artifactDir);
      const invalid = await verifyMoxelAtlasArtifact({ artifactDir });
      expect(
        invalid.diagnostics.map((diagnostic) => diagnostic.code),
      ).toContain("ATLAS_ARTIFACT_SCHEMA_INVALID");
      expect(
        invalid.diagnostics.map((diagnostic) => diagnostic.code),
      ).toContain("ATLAS_ARTIFACT_REPO_ID_INVALID");
      await writePrettyJson(manifestPath, manifest);
      await writeFile(join(artifactDir, "corpus.db"), "not sqlite");
      await writeArtifactChecksums(artifactDir);
      const corrupt = await verifyMoxelAtlasArtifact({ artifactDir });
      expect(
        corrupt.diagnostics.map((diagnostic) => diagnostic.code),
      ).toContain("ATLAS_ARTIFACT_CORPUS_UNIMPORTABLE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("artifact inspect returns docs counts", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-artifact-test-"));
    try {
      const artifactDir = await createArtifactFixture(root, {
        revision: "abc123",
      });
      const inspected = await inspectMoxelAtlasArtifact({ artifactDir });
      expect(inspected.docsIndex?.counts.documents).toBe(0);
      expect(inspected.manifest?.repoId).toBe("github.com/moxellabs/atlas");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createArtifactFixture(
  root: string,
  options: { revision: string },
): Promise<string> {
  const repoId = "github.com/moxellabs/atlas";
  const sourceDbPath = join(root, "source.db");
  const sourceDb = openStore({ path: sourceDbPath, migrate: true });
  try {
    new RepoRepository(sourceDb).upsert({
      repoId,
      mode: "local-git",
      revision: options.revision,
    });
    new ManifestRepository(sourceDb).upsert({
      repoId,
      indexedRevision: options.revision,
      compilerVersion: "test",
    });
    const artifactDir = join(root, ".moxel", "atlas");
    await mkdir(artifactDir, { recursive: true });
    await writePrettyJson(
      join(artifactDir, "manifest.json"),
      buildArtifactManifest({
        repoId,
        ref: "main",
        indexedRevision: options.revision,
      }),
    );
    await writePrettyJson(
      join(artifactDir, "docs.index.json"),
      buildDocsIndex(sourceDb, repoId),
    );
    sourceDb.close();
    await exportCorpusDbSnapshot(sourceDbPath, join(artifactDir, "corpus.db"));
    await writeArtifactChecksums(artifactDir);
    return artifactDir;
  } finally {
    try {
      sourceDb.close();
    } catch {
      // Already closed after docs index snapshot.
    }
  }
}
