import { stableHash } from "../utils/hash";
import { stableJson } from "../utils/stable-json";

/** Inputs used to derive a stable skill identity. */
export interface SkillIdInput {
  /** Stable repository identifier. */
  repoId: string;
  /** Optional package identity containing the skill. */
  packageId?: string | undefined;
  /** Optional module identity containing the skill. */
  moduleId?: string | undefined;
  /** Repository-relative skill path or stable skill name anchor. */
  path: string;
}

/** Creates a deterministic structural skill ID. */
export function createSkillId(input: SkillIdInput): string {
  return `skill_${stableHash(stableJson({ ...input, path: normalizePath(input.path) })).slice(0, 24)}`;
}

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
}
