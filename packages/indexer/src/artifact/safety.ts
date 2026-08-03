import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AtlasStoreClient, openStore } from "@atlas/store";

import { safetyArtifactFiles, type ArtifactDiagnostic } from "./contracts";

export async function scanArtifactSafety(
  artifactDir: string,
): Promise<{ valid: boolean; diagnostics: ArtifactDiagnostic[] }> {
  const diagnostics: ArtifactDiagnostic[] = [];
  const absolutePathPattern =
    /(?:\/home\/|\/Users\/|\/tmp\/|\/var\/|[A-Za-z]:\\\\)/;
  const secretPattern =
    /(?:authorization\s*:|password\s*:|secret\s*:|api[_-]?key\s*:|tokenEnvVar|ATLAS_GHES_TOKEN\s*=|GH_TOKEN\s*=)/i;
  for (const path of safetyArtifactFiles) {
    let text = "";
    try {
      text = await readFile(join(artifactDir, path), "utf8");
    } catch {
      continue;
    }
    if (absolutePathPattern.test(text)) {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_ABSOLUTE_PATH",
        path,
        message: `${path} contains an absolute local path.`,
      });
    }
    if (secretPattern.test(text)) {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_SECRET_FIELD",
        path,
        message: `${path} contains secret-like material.`,
      });
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

export async function exportCorpusDbSnapshot(
  sourceDbPath: string,
  targetDbPath: string,
): Promise<void> {
  await mkdir(dirname(targetDbPath), { recursive: true });
  await rm(targetDbPath, { force: true });
  await rm(`${targetDbPath}-wal`, { force: true });
  await rm(`${targetDbPath}-shm`, { force: true });
  await rm(`${targetDbPath}-journal`, { force: true });
  let checkpointDb: AtlasStoreClient | undefined;
  try {
    checkpointDb = openStore({ path: sourceDbPath, migrate: false });
    checkpointDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    checkpointDb?.close();
  }
  await copyFile(sourceDbPath, targetDbPath);
  await rm(`${targetDbPath}-wal`, { force: true });
  await rm(`${targetDbPath}-shm`, { force: true });
  await rm(`${targetDbPath}-journal`, { force: true });
}
