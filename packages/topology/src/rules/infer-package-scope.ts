import type { DocScope, PackageNode } from "@atlas/core";

import { containsPath, normalizeRepoPath, sortDeepestFirst } from "../path-utils";

/** Result of package-scope inference for one path. */
export interface PackageScopeInference {
  /** Deepest containing package, when one exists. */
  packageNode?: PackageNode | undefined;
  /** Package document scope, when one exists. */
  scope?: DocScope | undefined;
}

/** Infers the deepest containing package scope for a repo-local path. */
export function inferPackageScope(path: string, packages: readonly PackageNode[]): PackageScopeInference {
  const normalizedPath = normalizeRepoPath(path);
  const packageNode = sortDeepestFirst(packages).find((candidate) => containsPath(candidate.path, normalizedPath));
  if (!packageNode) {
    return {};
  }

  return {
    packageNode,
    scope: {
      level: "package",
      repoId: packageNode.repoId,
      packageId: packageNode.packageId
    }
  };
}
