import { loadConfig } from "@atlas/config";
import { rm, stat } from "node:fs/promises";

import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { readArgvString, renderSuccess } from "./shared";

interface CleanArtifact {
  path: string;
  bytes: number;
}

interface CleanResult {
  corpusDbPath: string;
  dryRun: boolean;
  removed: CleanArtifact[];
  missing: string[];
  totalBytes: number;
}

const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

/** Removes generated local corpus artifacts without touching managed repo caches. */
export async function runCleanCommand(context: CliCommandContext): Promise<CliCommandResult<CleanResult>> {
  const configPath = readArgvString(context.argv, "--config");
  const resolved = await loadConfig({
    cwd: context.cwd,
    ...(configPath === undefined ? {} : { configPath })
  });
  const dryRun = context.argv.includes("--dry-run");
  const corpusDbPath = resolved.config.corpusDbPath;
  const artifactPaths = corpusArtifactPaths(corpusDbPath);
  const existing = await existingArtifacts(artifactPaths);
  const existingPaths = new Set(existing.map((artifact) => artifact.path));
  const missing = artifactPaths.filter((path) => !existingPaths.has(path));

  if (!dryRun) {
    for (const artifact of existing) {
      await rm(artifact.path, { force: true });
    }
  }

  const totalBytes = existing.reduce((sum, artifact) => sum + artifact.bytes, 0);
  return renderSuccess(
    context,
    "clean",
    {
      corpusDbPath,
      dryRun,
      removed: existing,
      missing,
      totalBytes
    },
    [
      `${dryRun ? "Would remove" : "Removed"} ${existing.length} generated artifact${existing.length === 1 ? "" : "s"}.`,
      `Corpus DB: ${corpusDbPath}`,
      `Bytes: ${totalBytes}`,
      ...existing.map((artifact) => `- ${artifact.path}`)
    ]
  );
}

function corpusArtifactPaths(corpusDbPath: string): string[] {
  return [corpusDbPath, ...SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${corpusDbPath}${suffix}`)];
}

async function existingArtifacts(paths: readonly string[]): Promise<CleanArtifact[]> {
  const artifacts: CleanArtifact[] = [];
  for (const path of paths) {
    const details = await stat(path).catch((error: unknown) => {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    });
    if (details === undefined) {
      continue;
    }
    if (!details.isFile()) {
      continue;
    }
    artifacts.push({ path, bytes: details.size });
  }
  return artifacts;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
