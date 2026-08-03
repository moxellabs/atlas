import {
  type AtlasStoreClient,
  countRepoCorpusRows,
  getCurrentSchemaVersion,
  openStore,
} from "@atlas/store";

import {
  emptyArtifactCorpusImportCounts,
  MOXEL_ATLAS_ARTIFACT_SCHEMA,
  type ArtifactCorpusImportCounts,
  type ArtifactCorpusImportDiagnostic,
  type ArtifactCorpusImportInput,
  type ArtifactCorpusImportResult,
  type MoxelAtlasArtifactManifest,
} from "./contracts";
import { readArtifactManifestSync } from "./manifest";

function resolvedGlobalDbPath(input: ArtifactCorpusImportInput): string {
  if (input.globalDbPath !== undefined) return input.globalDbPath;
  const db = input.globalDb;
  if (
    db !== undefined &&
    typeof db === "object" &&
    "path" in db &&
    typeof db.path === "string"
  ) {
    return db.path;
  }
  return "";
}

export function validateArtifactCorpusDb(
  input: ArtifactCorpusImportInput,
): ArtifactCorpusImportResult {
  const importedAt = input.importedAt ?? new Date().toISOString();
  const globalDbPath = resolvedGlobalDbPath(input);
  const diagnostics: ArtifactCorpusImportDiagnostic[] = [];
  let manifest: MoxelAtlasArtifactManifest | undefined;
  try {
    manifest = readArtifactManifestSync(input.manifestPath);
  } catch {
    diagnostics.push({
      code: "ATLAS_ARTIFACT_CORPUS_SCHEMA_MISMATCH",
      path: input.manifestPath,
      message: "Artifact manifest is missing or unreadable.",
    });
  }
  if (
    manifest?.schema !== MOXEL_ATLAS_ARTIFACT_SCHEMA ||
    manifest.repoId !== input.repoId
  ) {
    diagnostics.push({
      code: "ATLAS_ARTIFACT_REPO_ID_MISMATCH",
      message: "Artifact manifest identity does not match repoId.",
    });
  }
  if (manifest?.format.corpusDbSchemaVersion !== input.expectedSchemaVersion) {
    diagnostics.push({
      code: "ATLAS_ARTIFACT_CORPUS_SCHEMA_MISMATCH",
      message: "Artifact corpus schema version does not match expected schema.",
    });
  }
  let db: AtlasStoreClient | undefined;
  try {
    db = openStore({ path: input.artifactDbPath, migrate: false });
    let schemaVersion = input.expectedSchemaVersion;
    try {
      schemaVersion = getCurrentSchemaVersion(db);
    } catch {
      // Older artifact snapshots may omit schema_migrations while still having the expected tables.
    }
    if (schemaVersion !== input.expectedSchemaVersion)
      diagnostics.push({
        code: "ATLAS_ARTIFACT_CORPUS_SCHEMA_MISMATCH",
        message:
          "Artifact corpus database schema version does not match expected schema.",
      });
    const counts = countRepoCorpusRows(
      db,
      input.repoId,
    ) as ArtifactCorpusImportCounts;
    const mixed = db.get<{ repoId: string }>(
      "SELECT repo_id AS repoId FROM repos WHERE repo_id <> $repoId LIMIT 1",
      { $repoId: input.repoId },
    );
    const docMixed = db.get<{ repoId: string }>(
      "SELECT repo_id AS repoId FROM documents WHERE repo_id <> $repoId LIMIT 1",
      { $repoId: input.repoId },
    );
    const ftsMixed = db.get<{ repoId: string }>(
      "SELECT repo_id AS repoId FROM fts_entries WHERE repo_id <> $repoId LIMIT 1",
      { $repoId: input.repoId },
    );
    if (mixed || docMixed || ftsMixed)
      diagnostics.push({
        code: "ATLAS_ARTIFACT_REPO_ID_MISMATCH",
        message: "Artifact corpus contains rows for a different repoId.",
      });
    return {
      repoId: input.repoId,
      artifactDbPath: input.artifactDbPath,
      globalDbPath,
      importedAt,
      replaced: emptyArtifactCorpusImportCounts(),
      counts,
      diagnostics,
    };
  } catch (error) {
    diagnostics.push({
      code: "ATLAS_ARTIFACT_CORPUS_SCHEMA_MISMATCH",
      message:
        error instanceof Error
          ? error.message
          : "Artifact corpus could not be opened.",
    });
    return {
      repoId: input.repoId,
      artifactDbPath: input.artifactDbPath,
      globalDbPath,
      importedAt,
      replaced: emptyArtifactCorpusImportCounts(),
      counts: emptyArtifactCorpusImportCounts(),
      diagnostics,
    };
  } finally {
    db?.close();
  }
}
