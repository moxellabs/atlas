import { stableHash } from "../utils/hash";
import { stableJson } from "../utils/stable-json";

/** Inputs used to derive a stable package identity. */
export interface PackageIdInput {
  /** Stable repository identifier. */
  repoId: string;
  /** Repository-relative package root path. */
  path: string;
}

/** Creates a deterministic structural package ID. */
export function createPackageId(input: PackageIdInput): string {
  return `pkg_${stableHash(stableJson({ repoId: input.repoId, path: normalizePath(input.path) })).slice(0, 24)}`;
}

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
}
