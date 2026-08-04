import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { isolateCorpusSnapshot } from "./corpus-snapshot";

export async function snapshotGlobalCorpus(input: {
  readonly workDir: string;
  readonly repoId: string;
}): Promise<{
  readonly configPath: string;
  readonly corpusDbPath: string;
  readonly tempConfigDir?: undefined;
  readonly source: "explicit-config";
  readonly corpusProvenance: {
    readonly indexedRevision: string;
    readonly corpusDigest: string;
  };
}> {
  const sourcePath = join(homedir(), ".moxel", "atlas", "corpus.db");
  const snapshotDir = join(input.workDir, "corpus-snapshot");
  const cacheDir = join(snapshotDir, "cache");
  const corpusDbPath = join(snapshotDir, "corpus.db");
  const configPath = join(snapshotDir, "atlas.config.json");
  const corpusProvenance = await isolateCorpusSnapshot({
    sourcePath,
    targetPath: corpusDbPath,
    repoId: input.repoId,
  });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: 1,
        cacheDir,
        corpusDbPath,
        logLevel: "warn",
        server: { transport: "stdio" },
        lifecycle: {
          repositoryRefresh: {
            enabled: false,
            intervalMs: 15 * 60 * 1000,
          },
        },
        hosts: [],
        repos: [],
      },
      null,
      2,
    )}\n`,
  );
  return {
    configPath,
    corpusDbPath,
    source: "explicit-config",
    corpusProvenance,
  };
}
