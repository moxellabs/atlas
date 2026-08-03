import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AtlasRepoConfig,
  DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH,
  parseCanonicalRepoId,
  repoPathSegments,
} from "@atlas/config";
import { parentDir } from "../utils/paths";
export interface RepoMetadata {
  schemaVersion: 1;
  repoId: string;
  host: string;
  owner: string;
  name: string;
  source:
    | {
        mode: "local-git";
        remote: string;
        localPath: string;
        ref: string;
        refMode: "remote" | "current-checkout";
      }
    | {
        mode: "ghes-api";
        baseUrl: string;
        owner: string;
        name: string;
        ref: string;
        tokenEnvVar: string | null;
      };
  createdAt: string;
  updatedAt: string;
  artifactPath: string | null;
  artifactSource?: "local-artifact" | "remote-artifact" | undefined;
  artifactValidatedAt?: string | undefined;
  indexedRevision?: string | undefined;
  remoteHeadRevision?: string | undefined;
  stale?: boolean | undefined;
  importStatus?: "ready" | "imported" | "missing-artifact" | undefined;
  indexSource?: "local-only" | undefined;
  checkoutPath?: string | undefined;
  importedAt?: string | undefined;
  globalCorpusPath?: string | undefined;
  importCounts?: Record<string, number> | undefined;
  documentationSignal?: Record<string, unknown> | undefined;
}

export function repoFolderPath(atlasHome: string, repoId: string): string {
  return join(
    atlasHome,
    DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH,
    ...repoPathSegments(repoId),
  );
}

export function repoMetadataPath(atlasHome: string, repoId: string): string {
  return join(repoFolderPath(atlasHome, repoId), "repo.json");
}

export function createRepoMetadata(
  repo: AtlasRepoConfig,
  now = new Date().toISOString(),
): RepoMetadata {
  const { host, owner, name } = parseCanonicalRepoId(repo.repoId);
  return {
    schemaVersion: 1,
    repoId: repo.repoId,
    host,
    owner,
    name,
    source:
      repo.mode === "local-git"
        ? {
            mode: "local-git",
            remote: repo.git?.remote ?? "",
            localPath: repo.git?.localPath ?? "",
            ref: repo.git?.ref ?? "",
            refMode: repo.git?.refMode ?? "remote",
          }
        : {
            mode: "ghes-api",
            baseUrl: repo.github?.baseUrl ?? "",
            owner: repo.github?.owner ?? "",
            name: repo.github?.name ?? "",
            ref: repo.github?.ref ?? "",
            tokenEnvVar: repo.github?.tokenEnvVar ?? null,
          },
    createdAt: now,
    updatedAt: now,
    artifactPath: null,
  };
}

export async function readRepoMetadata(path: string): Promise<RepoMetadata> {
  const metadata = JSON.parse(await readFile(path, "utf8")) as RepoMetadata;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.repoId === undefined ||
    metadata.host === undefined ||
    metadata.owner === undefined ||
    metadata.name === undefined ||
    metadata.source === undefined ||
    metadata.createdAt === undefined ||
    metadata.updatedAt === undefined ||
    !("artifactPath" in metadata)
  ) {
    throw new Error(`Invalid repo metadata: ${path}`);
  }
  return metadata;
}

export async function writeRepoMetadata(
  path: string,
  metadata: RepoMetadata,
): Promise<void> {
  await mkdir(parentDir(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function writeRepoArtifactMetadata(
  atlasHome: string,
  repoId: string,
  artifact: Pick<
    RepoMetadata,
    | "artifactPath"
    | "artifactSource"
    | "artifactValidatedAt"
    | "indexedRevision"
    | "remoteHeadRevision"
    | "stale"
    | "importStatus"
    | "indexSource"
    | "checkoutPath"
    | "importedAt"
    | "globalCorpusPath"
    | "importCounts"
    | "documentationSignal"
  >,
): Promise<void> {
  const path = repoMetadataPath(atlasHome, repoId);
  let metadata: RepoMetadata;
  try {
    metadata = await readRepoMetadata(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
    // First write can race before appendRepoConfig metadata lands; seed a shell.
    const { host, owner, name } = parseCanonicalRepoId(repoId);
    metadata = {
      schemaVersion: 1,
      repoId,
      host,
      owner,
      name,
      source: {
        mode: "local-git",
        remote: "",
        localPath: "",
        ref: "",
        refMode: "remote",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifactPath: null,
    };
  }
  await writeRepoMetadata(path, {
    ...metadata,
    ...artifact,
    updatedAt: new Date().toISOString(),
  });
}

export async function listRepoMetadata(
  atlasHome: string,
): Promise<RepoMetadata[]> {
  const root = join(atlasHome, DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH);
  const paths = await findRepoMetadataFiles(root);
  const metadata = await Promise.all(paths.map(readRepoMetadata));
  return metadata.sort((left, right) =>
    left.repoId.localeCompare(right.repoId),
  );
}

async function findRepoMetadataFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return findRepoMetadataFiles(path);
      return entry.isFile() && entry.name === "repo.json" ? [path] : [];
    }),
  );
  return paths.flat();
}

export async function removeRepoFolder(
  atlasHome: string,
  repoId: string,
): Promise<boolean> {
  await rm(repoFolderPath(atlasHome, repoId), { recursive: true, force: true });
  return true;
}
