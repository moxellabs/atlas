import type { DocScope, ModuleNode } from "@atlas/core";

import { containsPath, normalizeRepoPath, sortDeepestFirst } from "../path-utils";

/** Result of module-scope inference for one path. */
export interface ModuleScopeInference {
  /** Deepest containing module, when one exists. */
  moduleNode?: ModuleNode | undefined;
  /** Module document scope, when one exists. */
  scope?: DocScope | undefined;
}

/** Infers the deepest containing module scope for a repo-local path. */
export function inferModuleScope(path: string, modules: readonly ModuleNode[]): ModuleScopeInference {
  const normalizedPath = normalizeRepoPath(path);
  const moduleNode = sortDeepestFirst(modules).find((candidate) => containsPath(candidate.path, normalizedPath));
  if (!moduleNode) {
    return {};
  }

  const scope: DocScope = {
    level: "module",
    repoId: moduleNode.repoId,
    moduleId: moduleNode.moduleId
  };
  if (moduleNode.packageId) {
    scope.packageId = moduleNode.packageId;
  }

  return { moduleNode, scope };
}
