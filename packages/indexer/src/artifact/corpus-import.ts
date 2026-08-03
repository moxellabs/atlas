import {
  countRepoCorpusRows,
  deleteRepoCorpus,
  migrateStore,
  openStore,
  type StoreDatabase,
} from "@atlas/store";

import {
  type ArtifactCorpusImportCounts,
  type ArtifactCorpusImportInput,
  type ArtifactCorpusImportResult,
} from "./contracts";
import { validateArtifactCorpusDb } from "./corpus-validation";
function databasePath(db: StoreDatabase): string {
  if (typeof db === "object" && "path" in db && typeof db.path === "string") {
    return db.path;
  }
  return "";
}

export function importArtifactCorpus(
  input: ArtifactCorpusImportInput,
): ArtifactCorpusImportResult {
  const validation = validateArtifactCorpusDb(input);
  if (validation.diagnostics.length > 0) return validation;
  const importedAt = input.importedAt ?? new Date().toISOString();
  const globalDb =
    input.globalDb ??
    openStore({ path: input.globalDbPath ?? "", migrate: true });
  const closeGlobal = input.globalDb === undefined;
  const globalDbPath = input.globalDbPath ?? databasePath(globalDb);
  try {
    migrateStore(globalDb);
    const replaced = countRepoCorpusRows(
      globalDb,
      input.repoId,
    ) as ArtifactCorpusImportCounts;
    globalDb.run("ATTACH DATABASE $artifactDbPath AS artifact_import", {
      $artifactDbPath: input.artifactDbPath,
    });
    try {
      globalDb.transaction(() => {
        deleteRepoCorpus(globalDb, input.repoId);
        copyAttachedArtifactTables(globalDb);
      });
    } finally {
      globalDb.exec("DETACH DATABASE artifact_import");
    }
    return {
      ...validation,
      globalDbPath,
      importedAt,
      replaced,
      counts: countRepoCorpusRows(
        globalDb,
        input.repoId,
      ) as ArtifactCorpusImportCounts,
      diagnostics: [],
    };
  } catch (error) {
    return {
      ...validation,
      globalDbPath,
      importedAt,
      diagnostics: [
        {
          code: "ATLAS_ARTIFACT_CORPUS_IMPORT_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Artifact corpus import failed.",
        },
      ],
    };
  } finally {
    if (closeGlobal) globalDb.close();
  }
}

function copyAttachedArtifactTables(db: StoreDatabase): void {
  db.run("INSERT INTO repos SELECT * FROM artifact_import.repos");
  db.run("INSERT INTO packages SELECT * FROM artifact_import.packages");
  db.run("INSERT INTO modules SELECT * FROM artifact_import.modules");
  db.run("INSERT INTO documents SELECT * FROM artifact_import.documents");
  db.run(
    "INSERT INTO document_scopes SELECT * FROM artifact_import.document_scopes",
  );
  db.run("INSERT INTO sections SELECT * FROM artifact_import.sections");
  db.run("INSERT INTO chunks SELECT * FROM artifact_import.chunks");
  db.run("INSERT INTO summaries SELECT * FROM artifact_import.summaries");
  db.run("INSERT INTO skills SELECT * FROM artifact_import.skills");
  db.run(
    "INSERT INTO skill_artifacts SELECT * FROM artifact_import.skill_artifacts",
  );
  db.run("INSERT INTO manifests SELECT * FROM artifact_import.manifests");
  db.run("INSERT INTO fts_entries SELECT * FROM artifact_import.fts_entries");
}
