import type { ModuleNode, PackageNode, SkillNode, TopologyRule } from "@atlas/core";

import { normalizeRepoPath } from "../path-utils";
import { inferSkillScope } from "../rules/infer-skill-scope";

/** Options for classifying one potential skill path. */
export interface ClassifySkillOptions {
  /** Stable repository identifier. */
  repoId: string;
  /** Repository-relative path. */
  path: string;
  /** Discovered package nodes. */
  packages: readonly PackageNode[];
  /** Discovered module nodes. */
  modules: readonly ModuleNode[];
  /** Topology rules used for explicit skill patterns. */
  rules: readonly TopologyRule[];
}

/** Classifies a path as a skill node when it matches skill conventions or rules. */
export function classifySkill(options: ClassifySkillOptions): SkillNode | undefined {
  const path = normalizeRepoPath(options.path);
  const inference = inferSkillScope(path, options.repoId, options.packages, options.modules, options.rules);
  if (!inference.skillId) {
    return undefined;
  }

  return {
    skillId: inference.skillId,
    repoId: options.repoId,
    packageId: inference.packageId,
    moduleId: inference.moduleId,
    path,
    title: inference.title,
    sourceDocPath: path,
    topics: [],
    aliases: [],
    tokenCount: 0,
    diagnostics: [
      {
        reason: "Skill artifact identified from skill path convention or topology rule.",
        confidence: "high"
      }
    ]
  };
}
