import type { StoreDatabase } from "@atlas/store";

export const MOXEL_ATLAS_ARTIFACT_SCHEMA = "moxel-atlas-artifact/v1";
export const MOXEL_ATLAS_ARTIFACT_VERSION = 1;
export const MOXEL_ATLAS_ARTIFACT_FILES = [
  "manifest.json",
  "corpus.db",
  "checksums.json",
  "docs.index.json",
] as const;
export const MOXEL_ATLAS_CHECKSUMS_SCHEMA = "moxel-atlas-checksums/v1";

const [manifestFile, corpusFile, checksumsFile, docsIndexFile] =
  MOXEL_ATLAS_ARTIFACT_FILES;

export const artifactFiles = {
  manifest: manifestFile,
  corpus: corpusFile,
  checksums: checksumsFile,
  docsIndex: docsIndexFile,
} as const;

export const checksumArtifactFiles = [
  artifactFiles.corpus,
  artifactFiles.docsIndex,
  artifactFiles.manifest,
] as const;

export const safetyArtifactFiles = [
  artifactFiles.manifest,
  artifactFiles.docsIndex,
  artifactFiles.checksums,
] as const;

export const MOXEL_ATLAS_REPO_ARTIFACT_PATH = ".moxel/atlas";
export const MOXEL_ATLAS_REMOTE_ARTIFACT_FILES = [
  artifactFiles.manifest,
  artifactFiles.corpus,
  artifactFiles.docsIndex,
  artifactFiles.checksums,
] as const;

export interface MoxelAtlasArtifactManifest {
  schema: typeof MOXEL_ATLAS_ARTIFACT_SCHEMA;
  repoId: string;
  host: string;
  owner: string;
  name: string;
  ref: string;
  indexedRevision: string;
  createdAt: string;
  atlasVersion: string;
  format: {
    version: typeof MOXEL_ATLAS_ARTIFACT_VERSION;
    files: typeof MOXEL_ATLAS_ARTIFACT_FILES;
    corpusDbSchemaVersion: number;
  };
  profiles: {
    default: "public";
    available: string[];
    applied: string;
  };
}

export interface BuildArtifactManifestInput {
  repoId: string;
  ref: string;
  indexedRevision?: string | undefined;
  createdAt?: string | undefined;
  atlasVersion?: string | undefined;
  corpusDbSchemaVersion?: number | undefined;
  profile?: string | undefined;
  availableProfiles?: string[] | undefined;
}

export interface MoxelAtlasDocsIndex {
  schema: "moxel-atlas-docs-index/v1";
  repoId: string;
  generatedAt: string;
  counts: {
    documents: number;
    skills: number;
    packages: number;
    modules: number;
  };
  documents: MoxelAtlasDocsIndexDocument[];
}

export interface MoxelAtlasDocsIndexDocument {
  path: string;
  docId: string;
  title?: string | undefined;
  kind: string;
  authority: string;
  packageId?: string | undefined;
  moduleId?: string | undefined;
  skillId?: string | undefined;
  description?: string | undefined;
  audience: string[];
  purpose: string[];
  visibility: string;
  order?: number | undefined;
  profile?: string | undefined;
  contentHash: string;
  sourceVersion: string;
  tags: string[];
  scopes: unknown[];
}

export interface ArtifactDiagnostic {
  code: string;
  path?: string | undefined;
  message: string;
}

export interface ArtifactChecksumEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface ArtifactChecksumResult {
  valid: boolean;
  files: ArtifactChecksumEntry[];
  diagnostics: ArtifactDiagnostic[];
}

export interface ArtifactCorpusImportCounts {
  repos: number;
  packages: number;
  modules: number;
  documents: number;
  sections: number;
  chunks: number;
  summaries: number;
  skills: number;
  manifests: number;
  ftsRows: number;
}

export interface ArtifactCorpusImportDiagnostic {
  code: string;
  message: string;
  path?: string | undefined;
}

export interface ArtifactCorpusImportInput {
  repoId: string;
  artifactDbPath: string;
  manifestPath: string;
  expectedSchemaVersion: number;
  globalDbPath?: string | undefined;
  globalDb?: StoreDatabase | undefined;
  importedAt?: string | undefined;
}

export interface ArtifactCorpusImportResult {
  repoId: string;
  artifactDbPath: string;
  globalDbPath: string;
  importedAt: string;
  replaced: ArtifactCorpusImportCounts;
  counts: ArtifactCorpusImportCounts;
  diagnostics: ArtifactCorpusImportDiagnostic[];
}

export interface ArtifactVerificationInput {
  artifactDir: string;
  expectedRepoId?: string | undefined;
  freshRef?: string | undefined;
  requireFresh?: boolean | undefined;
  importCheckDbPath?: string | undefined;
}

export interface ArtifactVerificationResult {
  valid: boolean;
  artifactDir: string;
  repoId?: string | undefined;
  manifest?: MoxelAtlasArtifactManifest | undefined;
  diagnostics: ArtifactDiagnostic[];
  checksum: ArtifactChecksumResult;
  safety: { valid: boolean; diagnostics: ArtifactDiagnostic[] };
  importable: boolean;
  counts: ArtifactCorpusImportCounts;
  fresh?: boolean | undefined;
  expectedRevision?: string | undefined;
  indexedRevision?: string | undefined;
}

export interface ArtifactInspectionResult {
  artifactDir: string;
  manifest?: MoxelAtlasArtifactManifest | undefined;
  files: ArtifactChecksumEntry[];
  docsIndex?: MoxelAtlasDocsIndex | undefined;
  checksumStatus: ArtifactChecksumResult;
  safetyStatus: { valid: boolean; diagnostics: ArtifactDiagnostic[] };
  diagnostics: ArtifactDiagnostic[];
}

export interface RemoteArtifactDiagnostic {
  code: string;
  message: string;
  path?: string | undefined;
}

export interface RemoteArtifactFetchInput {
  apiUrl: string;
  owner: string;
  name: string;
  ref: string;
  repoId: string;
  artifactDir: string;
  token?: string | undefined;
  artifactRoot?: string | undefined;
}

export interface RemoteArtifactFetchResult {
  ok: boolean;
  code?: string | undefined;
  repoId: string;
  host: string;
  owner: string;
  name: string;
  ref: string;
  artifactDir: string;
  files: string[];
  indexedRevision?: string | undefined;
  remoteHeadRevision?: string | undefined;
  stale?: boolean | undefined;
  diagnostics: RemoteArtifactDiagnostic[];
}

export interface RemoteArtifactHeadResult {
  ok: boolean;
  code?: string | undefined;
  ref: string;
  remoteHeadRevision?: string | undefined;
  diagnostics: RemoteArtifactDiagnostic[];
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export function emptyArtifactCorpusImportCounts(): ArtifactCorpusImportCounts {
  return {
    repos: 0,
    packages: 0,
    modules: 0,
    documents: 0,
    sections: 0,
    chunks: 0,
    summaries: 0,
    skills: 0,
    manifests: 0,
    ftsRows: 0,
  };
}
