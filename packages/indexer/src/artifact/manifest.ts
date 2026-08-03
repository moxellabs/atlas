import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ATLAS_VERSION } from "@atlas/core";
import {
  DocRepository,
  ManifestRepository,
  STORE_SCHEMA_VERSION,
  type StoreDatabase,
} from "@atlas/store";

import {
  MOXEL_ATLAS_ARTIFACT_FILES,
  MOXEL_ATLAS_ARTIFACT_SCHEMA,
  MOXEL_ATLAS_ARTIFACT_VERSION,
  type BuildArtifactManifestInput,
  type MoxelAtlasArtifactManifest,
  type MoxelAtlasDocsIndex,
} from "./contracts";

export function parseArtifactRepoId(repoId: string): [string, string, string] {
  const segments = repoId.split("/");
  if (segments.length !== 3 || segments.some((part) => part.length === 0)) {
    const error = new Error(
      "ATLAS_ARTIFACT_INVALID_REPO_ID: repoId must be host/owner/name",
    );
    (error as Error & { code?: string }).code =
      "ATLAS_ARTIFACT_INVALID_REPO_ID";
    throw error;
  }
  return segments as [string, string, string];
}

export function buildArtifactManifest(
  input: BuildArtifactManifestInput,
): MoxelAtlasArtifactManifest {
  const [host, owner, name] = parseArtifactRepoId(input.repoId);
  return {
    schema: MOXEL_ATLAS_ARTIFACT_SCHEMA,
    repoId: input.repoId,
    host,
    owner,
    name,
    ref: input.ref,
    indexedRevision: input.indexedRevision ?? input.ref,
    createdAt: input.createdAt ?? new Date().toISOString(),
    atlasVersion: input.atlasVersion ?? ATLAS_VERSION,
    format: {
      version: MOXEL_ATLAS_ARTIFACT_VERSION,
      files: MOXEL_ATLAS_ARTIFACT_FILES,
      corpusDbSchemaVersion:
        input.corpusDbSchemaVersion ?? STORE_SCHEMA_VERSION,
    },
    profiles: {
      default: "public",
      available: input.availableProfiles ?? ["public"],
      applied: input.profile ?? "public",
    },
  };
}

export function buildDocsIndex(
  db: StoreDatabase,
  repoId: string,
  generatedAt = new Date().toISOString(),
): MoxelAtlasDocsIndex {
  const docs = new DocRepository(db).listByRepo(repoId);
  const skillIds = new Set(docs.flatMap((doc) => doc.skillId ?? []));
  const packageIds = new Set(docs.flatMap((doc) => doc.packageId ?? []));
  const moduleIds = new Set(docs.flatMap((doc) => doc.moduleId ?? []));
  return {
    schema: "moxel-atlas-docs-index/v1",
    repoId,
    generatedAt,
    counts: {
      documents: docs.length,
      skills: skillIds.size,
      packages: packageIds.size,
      modules: moduleIds.size,
    },
    documents: docs
      .map((doc) => ({
        path: doc.path,
        docId: doc.docId,
        ...(doc.title === undefined ? {} : { title: doc.title }),
        kind: doc.kind,
        authority: doc.authority,
        ...(doc.packageId === undefined ? {} : { packageId: doc.packageId }),
        ...(doc.moduleId === undefined ? {} : { moduleId: doc.moduleId }),
        ...(doc.skillId === undefined ? {} : { skillId: doc.skillId }),
        ...(doc.description === undefined
          ? {}
          : { description: doc.description }),
        audience: doc.audience,
        purpose: doc.purpose,
        visibility: doc.visibility,
        ...(doc.order === undefined ? {} : { order: doc.order }),
        ...(doc.profile === undefined ? {} : { profile: doc.profile }),
        contentHash: doc.contentHash,
        sourceVersion: doc.sourceVersion,
        tags: doc.tags,
        scopes: doc.scopes,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function readArtifactJson<T>(path: string): Promise<T> {
  return readFile(path, "utf8").then(JSON.parse);
}

export function readArtifactManifest(
  path: string,
): Promise<MoxelAtlasArtifactManifest> {
  return readArtifactJson(path);
}

export function readArtifactManifestSync(
  path: string,
): MoxelAtlasArtifactManifest {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function manifestFromStore(
  db: StoreDatabase,
  repoId: string,
  ref: string,
  profile = "public",
  availableProfiles = [profile],
): MoxelAtlasArtifactManifest {
  const manifest = new ManifestRepository(db).get(repoId);
  return buildArtifactManifest({
    repoId,
    ref,
    indexedRevision: manifest?.indexedRevision ?? ref,
    corpusDbSchemaVersion: manifest?.schemaVersion ?? STORE_SCHEMA_VERSION,
    profile,
    availableProfiles,
  });
}
