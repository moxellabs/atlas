import { stableHash } from "../utils/hash";
import { stableJson } from "../utils/stable-json";

/** Inputs used to derive a stable document identity. */
export interface DocIdInput {
  /** Stable repository identifier. */
  repoId: string;
  /** Repository-relative document path. */
  path: string;
}

/** Creates a deterministic structural document ID. */
export function createDocId(input: DocIdInput): string {
  return `doc_${hashIdentity({ repoId: input.repoId, path: normalizePath(input.path) })}`;
}

function hashIdentity(value: unknown): string {
  return stableHash(stableJson(value)).slice(0, 24);
}

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
}
