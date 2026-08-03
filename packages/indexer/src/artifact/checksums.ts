import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  artifactFiles,
  checksumArtifactFiles,
  MOXEL_ATLAS_CHECKSUMS_SCHEMA,
  type ArtifactChecksumEntry,
  type ArtifactChecksumResult,
  type ArtifactDiagnostic,
} from "./contracts";

export async function writePrettyJson(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeArtifactChecksums(
  artifactDir: string,
): Promise<void> {
  const files = await checksumEntries(artifactDir);
  await writePrettyJson(join(artifactDir, artifactFiles.checksums), {
    schema: MOXEL_ATLAS_CHECKSUMS_SCHEMA,
    algorithm: "sha256",
    files,
  });
}

export async function validateArtifactChecksums(
  artifactDir: string,
): Promise<ArtifactChecksumResult> {
  const diagnostics: ArtifactDiagnostic[] = [];
  let expected: { files?: ArtifactChecksumEntry[] };
  try {
    expected = JSON.parse(
      await readFile(join(artifactDir, artifactFiles.checksums), "utf8"),
    ) as { files?: ArtifactChecksumEntry[] };
  } catch {
    return {
      valid: false,
      files: [],
      diagnostics: [
        {
          code: "ATLAS_ARTIFACT_FILE_MISSING",
          path: artifactFiles.checksums,
          message: "checksums.json is missing or unreadable.",
        },
      ],
    };
  }
  const files: ArtifactChecksumEntry[] = [];
  for (const entry of expected.files ?? []) {
    try {
      const actual = await checksumArtifactEntry(artifactDir, entry.path);
      files.push(actual);
      if (
        actual.sha256 !== entry.sha256 ||
        actual.sizeBytes !== entry.sizeBytes
      ) {
        diagnostics.push({
          code: "ATLAS_ARTIFACT_CHECKSUM_MISMATCH",
          path: entry.path,
          message: `${entry.path} checksum mismatch.`,
        });
      }
    } catch {
      diagnostics.push({
        code: "ATLAS_ARTIFACT_FILE_MISSING",
        path: entry.path,
        message: `${entry.path} is missing.`,
      });
    }
  }
  return { valid: diagnostics.length === 0, files, diagnostics };
}

export async function checksumArtifactEntry(
  artifactDir: string,
  path: string,
): Promise<ArtifactChecksumEntry> {
  const bytes = await readFile(join(artifactDir, path));
  const size = await stat(join(artifactDir, path));
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: size.size,
  };
}

async function checksumEntries(
  artifactDir: string,
): Promise<ArtifactChecksumEntry[]> {
  const entries = await Promise.all(
    checksumArtifactFiles.map((path) =>
      checksumArtifactEntry(artifactDir, path),
    ),
  );
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
