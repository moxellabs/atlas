import type { FileEntry, ModuleNode, PackageNode, TopologyRule } from "@atlas/core";
import { createModuleId } from "@atlas/core";

import { basename, containsPath, dirname, normalizeRepoPath, pathSegments } from "../path-utils";
import { discoveryDiagnostic } from "../diagnostics";
import type { TopologyDiscoveryDiagnostic } from "../diagnostics";
import { InconsistentModuleDiscoveryError, TopologyIdCollisionError } from "../errors";
import { inferPackageScope } from "../rules/infer-package-scope";
import { isMatch } from "../rules/evaluate-topology-rules";

/** Options for module discovery from repo paths and topology rules. */
export interface DiscoverModulesOptions {
  /** Stable repository identifier. */
  repoId: string;
  /** Materialized repo file entries. */
  files: readonly FileEntry[];
  /** Discovered packages used for package association. */
  packages: readonly PackageNode[];
  /** Topology rules that may include module root hints. */
  rules: readonly TopologyRule[];
}

/** Discovers path-based modules from module-local docs and rule hints. */
export function discoverModules(options: DiscoverModulesOptions): ModuleNode[] {
  return discoverModulesWithDiagnostics(options).modules;
}

/** Result of module discovery including non-node diagnostics. */
export interface DiscoverModulesResult {
  /** Discovered module nodes. */
  modules: ModuleNode[];
  /** Discovery diagnostics that do not fit on ModuleNode. */
  diagnostics: TopologyDiscoveryDiagnostic[];
}

/** Discovers modules and reports fallback/ambiguity diagnostics. */
export function discoverModulesWithDiagnostics(options: DiscoverModulesOptions): DiscoverModulesResult {
  const roots = collectModuleRootCandidates(options.files, options.packages, options.rules);
  const diagnostics: TopologyDiscoveryDiagnostic[] = [];
  const modules = roots.map((root) => {
    const packageNode = inferPackageScope(root, options.packages).packageNode;
    return {
      moduleId: createModuleId({ repoId: options.repoId, packageId: packageNode?.packageId, path: root }),
      repoId: options.repoId,
      packageId: packageNode?.packageId,
      name: basename(root),
      path: root
    };
  });

  const uniqueModules = assertUniqueModules(modules);
  if (uniqueModules.length === 0) {
    diagnostics.push(discoveryDiagnostic("No module roots discovered from module-local docs or topology rule hints.", "low"));
  }
  return {
    modules: uniqueModules.sort((left, right) => left.path.localeCompare(right.path)),
    diagnostics
  };
}

/** Collects valid module root candidates from paths and rule moduleRootPattern hints. */
export function collectModuleRootCandidates(
  files: readonly FileEntry[],
  packages: readonly PackageNode[],
  rules: readonly TopologyRule[]
): string[] {
  const roots = new Set<string>();
  const filePaths = files.filter((file) => file.type === "file").map((file) => normalizeRepoPath(file.path));

  for (const path of filePaths) {
    const docsRoot = moduleRootBeforeDocs(path);
    if (docsRoot && isValidModuleRoot(docsRoot, packages)) {
      roots.add(docsRoot);
    }

    for (const rule of rules) {
      const pattern = rule.ownership.moduleRootPattern;
      if (pattern && isMatch(path, pattern)) {
        const inferred = moduleRootBeforeDocs(path) ?? dirname(path);
        if (isValidModuleRoot(inferred, packages)) {
          roots.add(inferred);
        }
      }
    }
  }

  return [...roots].sort((left, right) => left.localeCompare(right));
}

function moduleRootBeforeDocs(path: string): string | undefined {
  const segments = pathSegments(path);
  const docsIndex = segments.indexOf("docs");
  if (docsIndex <= 0) {
    return undefined;
  }
  return segments.slice(0, docsIndex).join("/");
}

function isValidModuleRoot(root: string, packages: readonly PackageNode[]): boolean {
  if (basename(root) === "docs") {
    return false;
  }
  return !packages.some((packageNode) => normalizeRepoPath(packageNode.path) === root);
}

function assertUniqueModules(modules: ModuleNode[]): ModuleNode[] {
  const byPath = new Map<string, ModuleNode>();
  const byId = new Map<string, ModuleNode>();
  for (const moduleNode of modules) {
    const existingId = byId.get(moduleNode.moduleId);
    if (existingId && existingId.path !== moduleNode.path) {
      throw new TopologyIdCollisionError("Distinct module paths produced the same module ID.", {
        moduleId: moduleNode.moduleId,
        paths: [existingId.path, moduleNode.path]
      });
    }
    const existingPath = byPath.get(moduleNode.path);
    if (existingPath && existingPath.packageId !== moduleNode.packageId) {
      throw new InconsistentModuleDiscoveryError("Module path was associated with conflicting package IDs.", {
        path: moduleNode.path,
        packageIds: [existingPath.packageId, moduleNode.packageId]
      });
    }
    byPath.set(moduleNode.path, moduleNode);
    byId.set(moduleNode.moduleId, moduleNode);
  }
  return [...byPath.values()].filter((moduleNode) =>
    [...byPath.values()].every(
      (candidate) => candidate.path === moduleNode.path || !containsPath(moduleNode.path, candidate.path)
    )
  );
}
