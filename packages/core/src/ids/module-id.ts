import { stableHash } from "../utils/hash";
import { stableJson } from "../utils/stable-json";

/** Inputs used to derive a stable module identity. */
export interface ModuleIdInput {
  /** Stable repository identifier. */
  repoId: string;
  /** Optional parent package identity. */
  packageId?: string | undefined;
  /** Repository-relative module root path. */
  path: string;
}

/** Creates a deterministic structural module ID. */
export function createModuleId(input: ModuleIdInput): string {
  return `mod_${stableHash(stableJson({ ...input, path: normalizePath(input.path) })).slice(0, 24)}`;
}

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
}
