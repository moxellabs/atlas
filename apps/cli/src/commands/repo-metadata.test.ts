import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AtlasRepoConfig } from "@atlas/config";
import {
  createRepoMetadata,
  listRepoMetadata,
  repoMetadataPath,
  writeRepoMetadata,
} from "./repo-metadata";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("listRepoMetadata", () => {
  test("returns an empty list when the repository metadata root is absent", async () => {
    const atlasHome = await temporaryAtlasHome();

    expect(await listRepoMetadata(atlasHome)).toEqual([]);
  });

  test("walks nested metadata directories and sorts by repository id", async () => {
    const atlasHome = await temporaryAtlasHome();
    for (const repoId of [
      "github.enterprise.test/platform/docs",
      "github.com/moxellabs/atlas",
    ]) {
      await writeRepoMetadata(
        repoMetadataPath(atlasHome, repoId),
        createRepoMetadata(repoConfig(repoId), "2026-08-03T00:00:00.000Z"),
      );
    }
    const ignored = join(atlasHome, ".moxel", "atlas", "repos", "ignored");
    await mkdir(ignored, { recursive: true });
    await writeFile(join(ignored, "other.json"), "{}\n");

    const metadata = await listRepoMetadata(atlasHome);
    expect(metadata.map(({ repoId }) => repoId)).toEqual([
      "github.com/moxellabs/atlas",
      "github.enterprise.test/platform/docs",
    ]);
  });
});

async function temporaryAtlasHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "atlas-repo-metadata-test-"));
  roots.push(root);
  return root;
}

function repoConfig(repoId: string): AtlasRepoConfig {
  return {
    repoId,
    mode: "local-git",
    git: {
      remote: `https://${repoId}.git`,
      localPath: `/tmp/${repoId}`,
      ref: "main",
      refMode: "remote",
    },
  } as AtlasRepoConfig;
}
