import type { DocScope, ModuleNode, PackageNode, TopologyRule } from "@atlas/core";
import { createSkillId } from "@atlas/core";

import { basename, dirname, normalizeRepoPath } from "../path-utils";
import { inferModuleScope } from "./infer-module-scope";
import { inferPackageScope } from "./infer-package-scope";
import { isMatch } from "./evaluate-topology-rules";

/** Result of skill-scope inference for one path. */
export interface SkillScopeInference {
  /** Deterministic skill identifier, when path is a skill artifact. */
  skillId?: string | undefined;
  /** Skill display title derived from path. */
  title?: string | undefined;
  /** Skill document scope, when one exists. */
  scope?: DocScope | undefined;
  /** Owning package identifier, when inferred. */
  packageId?: string | undefined;
  /** Owning module identifier, when inferred. */
  moduleId?: string | undefined;
}

/** Infers whether a path is a skill artifact and returns ownership scope. */
export function inferSkillScope(
  path: string,
  repoId: string,
  packages: readonly PackageNode[],
  modules: readonly ModuleNode[],
  rules: readonly TopologyRule[] = []
): SkillScopeInference {
  const normalizedPath = normalizeRepoPath(path);
  if (!isSkillPath(normalizedPath, rules)) {
    return {};
  }

  const packageNode = inferPackageScope(normalizedPath, packages).packageNode;
  const moduleNode = inferModuleScope(normalizedPath, modules).moduleNode;
  const skillRoot = basename(normalizedPath).toLowerCase() === "skill.md" ? dirname(normalizedPath) : normalizedPath;
  const skillId = createSkillId({
    repoId,
    packageId: moduleNode?.packageId ?? packageNode?.packageId,
    moduleId: moduleNode?.moduleId,
    path: skillRoot
  });

  const packageId = moduleNode?.packageId ?? packageNode?.packageId;
  const moduleId = moduleNode?.moduleId;
  const scope: DocScope = {
    level: "skill",
    repoId,
    skillId
  };
  if (packageId) {
    scope.packageId = packageId;
  }
  if (moduleId) {
    scope.moduleId = moduleId;
  }

  return {
    skillId,
    title: deriveSkillTitle(skillRoot),
    packageId,
    moduleId,
    scope
  };
}

/** Returns true when a path is a skill artifact by convention or explicit rule. */
export function isSkillPath(path: string, rules: readonly TopologyRule[] = []): boolean {
  const normalizedPath = normalizeRepoPath(path);
  return (
    basename(normalizedPath).toLowerCase() === "skill.md" ||
    rules.some((rule) => rule.ownership.skillPattern && isMatch(normalizedPath, rule.ownership.skillPattern))
  );
}

function deriveSkillTitle(skillRoot: string): string {
  return basename(skillRoot)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
