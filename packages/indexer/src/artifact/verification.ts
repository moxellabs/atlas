import { stat } from "node:fs/promises";
import { join } from "node:path";
import { STORE_SCHEMA_VERSION } from "@atlas/store";

import {
  artifactFiles,
  emptyArtifactCorpusImportCounts,
  MOXEL_ATLAS_ARTIFACT_FILES,
  MOXEL_ATLAS_ARTIFACT_SCHEMA,
  type ArtifactChecksumEntry,
  type ArtifactDiagnostic,
  type ArtifactInspectionResult,
  type ArtifactVerificationInput,
  type ArtifactVerificationResult,
  type MoxelAtlasArtifactManifest,
  type MoxelAtlasDocsIndex,
} from "./contracts";
import { checksumArtifactEntry, validateArtifactChecksums } from "./checksums";
import { readArtifactJson, readArtifactManifest } from "./manifest";
import { validateArtifactCorpusDb } from "./corpus-validation";
import { scanArtifactSafety } from "./safety";

export async function verifyMoxelAtlasArtifact(
  input: ArtifactVerificationInput,
): Promise<ArtifactVerificationResult> {
  const diagnostics: ArtifactDiagnostic[] = [];
  let manifest: MoxelAtlasArtifactManifest | undefined;
  try {
    manifest = await readArtifactManifest(
      join(input.artifactDir, artifactFiles.manifest),
    );
  } catch {
    diagnostics.push({
      code: "ATLAS_ARTIFACT_SCHEMA_INVALID",
      path: artifactFiles.manifest,
      message: "manifest.json is missing or invalid.",
    });
  }
  if (manifest !== undefined) {
    if (manifest.schema !== MOXEL_ATLAS_ARTIFACT_SCHEMA) {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_SCHEMA_INVALID",
        path: artifactFiles.manifest,
        message: "Artifact manifest schema is invalid.",
      });
    }
    const segments = manifest.repoId.split("/");
    if (
      segments.length !== 3 ||
      segments.some((segment) => segment.length === 0)
    ) {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_REPO_ID_INVALID",
        path: artifactFiles.manifest,
        message: "Artifact repoId must be host/owner/name.",
      });
    }
    if (
      input.expectedRepoId !== undefined &&
      manifest.repoId !== input.expectedRepoId
    ) {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_REPO_ID_MISMATCH",
        path: artifactFiles.manifest,
        message: "Artifact repoId does not match expected repoId.",
      });
    }
  }
  for (const file of MOXEL_ATLAS_ARTIFACT_FILES) {
    try {
      await stat(join(input.artifactDir, file));
    } catch {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_FILE_MISSING",
        path: file,
        message: `${file} is missing.`,
      });
    }
  }
  const checksum = await validateArtifactChecksums(input.artifactDir);
  diagnostics.push(...checksum.diagnostics);
  const safety = await scanArtifactSafety(input.artifactDir);
  diagnostics.push(...safety.diagnostics);
  let importable = false;
  let counts = emptyArtifactCorpusImportCounts();
  if (manifest !== undefined) {
    const imported = validateArtifactCorpusDb({
      repoId: manifest.repoId,
      artifactDbPath: join(input.artifactDir, artifactFiles.corpus),
      manifestPath: join(input.artifactDir, artifactFiles.manifest),
      expectedSchemaVersion:
        manifest.format?.corpusDbSchemaVersion ?? STORE_SCHEMA_VERSION,
      globalDbPath: input.importCheckDbPath ?? "",
    });
    counts = imported.counts;
    importable = imported.diagnostics.length === 0;
    if (!importable) {
      diagnostics.push(
        ...imported.diagnostics.map((diagnostic) => ({
          code: "ATLAS_ARTIFACT_CORPUS_UNIMPORTABLE",
          path: diagnostic.path ?? artifactFiles.corpus,
          message: diagnostic.message,
        })),
      );
    }
  }
  let fresh: boolean | undefined;
  let expectedRevision: string | undefined;
  let indexedRevision: string | undefined;
  if (input.requireFresh === true) {
    expectedRevision = input.freshRef;
    indexedRevision = manifest?.indexedRevision;
    fresh =
      expectedRevision !== undefined && indexedRevision === expectedRevision;
    if (!fresh) {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_STALE",
        path: artifactFiles.manifest,
        message: "Artifact is stale; run atlas build and commit .moxel/atlas.",
      });
    }
  }
  return {
    valid: diagnostics.length === 0,
    artifactDir: input.artifactDir,
    repoId: manifest?.repoId,
    manifest,
    diagnostics,
    checksum,
    safety,
    importable,
    counts,
    ...(fresh === undefined ? {} : { fresh }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(indexedRevision === undefined ? {} : { indexedRevision }),
  };
}

export async function inspectMoxelAtlasArtifact(input: {
  artifactDir: string;
}): Promise<ArtifactInspectionResult> {
  const diagnostics: ArtifactDiagnostic[] = [];
  let manifest: MoxelAtlasArtifactManifest | undefined;
  let docsIndex: MoxelAtlasDocsIndex | undefined;
  try {
    manifest = await readArtifactManifest(
      join(input.artifactDir, artifactFiles.manifest),
    );
  } catch {
    diagnostics.push({
      code: "ATLAS_ARTIFACT_SCHEMA_INVALID",
      path: artifactFiles.manifest,
      message: "manifest.json is missing or invalid.",
    });
  }
  try {
    docsIndex = await readArtifactJson<MoxelAtlasDocsIndex>(
      join(input.artifactDir, artifactFiles.docsIndex),
    );
  } catch {
    diagnostics.push({
      code: "ATLAS_ARTIFACT_DOCS_INDEX_INVALID",
      path: artifactFiles.docsIndex,
      message: "docs.index.json is missing or invalid.",
    });
  }
  const checksumStatus = await validateArtifactChecksums(input.artifactDir);
  const safetyStatus = await scanArtifactSafety(input.artifactDir);
  const files: ArtifactChecksumEntry[] = [];
  for (const file of MOXEL_ATLAS_ARTIFACT_FILES) {
    try {
      files.push(await checksumArtifactEntry(input.artifactDir, file));
    } catch {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_FILE_MISSING",
        path: file,
        message: `${file} is missing.`,
      });
    }
  }
  return {
    artifactDir: input.artifactDir,
    manifest,
    files,
    docsIndex,
    checksumStatus,
    safetyStatus,
    diagnostics,
  };
}

export async function validateFetchedArtifact(
  artifactDir: string,
  expected: { repoId: string; host: string; owner: string; name: string },
): Promise<{
  valid: boolean;
  manifest?: MoxelAtlasArtifactManifest | undefined;
  diagnostics: ArtifactDiagnostic[];
}> {
  const diagnostics: ArtifactDiagnostic[] = [];
  let manifest: MoxelAtlasArtifactManifest | undefined;
  try {
    manifest = await readArtifactManifest(
      join(artifactDir, artifactFiles.manifest),
    );
  } catch {
    diagnostics.push({
      code: "CLI_ARTIFACT_SCHEMA_INVALID",
      path: artifactFiles.manifest,
      message: "manifest.json missing or invalid.",
    });
  }
  if (manifest) {
    if (manifest.schema !== MOXEL_ATLAS_ARTIFACT_SCHEMA)
      diagnostics.push({
        code: "CLI_ARTIFACT_SCHEMA_INVALID",
        path: artifactFiles.manifest,
        message: "Artifact manifest schema is invalid.",
      });
    if (
      manifest.repoId !== expected.repoId ||
      manifest.host !== expected.host ||
      manifest.owner !== expected.owner ||
      manifest.name !== expected.name
    )
      diagnostics.push({
        code: "CLI_ARTIFACT_ID_MISMATCH",
        path: artifactFiles.manifest,
        message: "Artifact manifest identity does not match requested repo.",
      });
  }
  const checksums = await validateArtifactChecksums(artifactDir);
  if (!checksums.valid)
    diagnostics.push(
      ...checksums.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        code: "CLI_ARTIFACT_CHECKSUM_INVALID",
      })),
    );
  const safety = await scanArtifactSafety(artifactDir);
  if (!safety.valid)
    diagnostics.push(
      ...safety.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        code: "CLI_ARTIFACT_SAFETY_INVALID",
      })),
    );
  return { valid: diagnostics.length === 0, manifest, diagnostics };
}
