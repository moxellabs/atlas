import type { FileEntry, PackageNode, WorkspaceConfig } from "@atlas/core";
import { createPackageId } from "@atlas/core";
import { join } from "node:path";

import { basename, dirname, normalizeRepoPath } from "../path-utils";
import { discoveryDiagnostic } from "../diagnostics";
import type { TopologyDiscoveryDiagnostic } from "../diagnostics";
import { InconsistentPackageDiscoveryError, TopologyIdCollisionError } from "../errors";
import { isMatch } from "../rules/evaluate-topology-rules";

/** Options for package discovery from a materialized repo file list. */
export interface DiscoverPackagesOptions {
  /** Stable repository identifier. */
  repoId: string;
  /** Local checkout root path used for optional manifest reads. */
  rootPath: string;
  /** Materialized repo file entries. */
  files: readonly FileEntry[];
  /** Workspace package discovery configuration. */
  workspace: Pick<WorkspaceConfig, "packageGlobs" | "packageManifestFiles">;
}

/** Discovers packages from configured manifest files and package root globs. */
export async function discoverPackages(options: DiscoverPackagesOptions): Promise<PackageNode[]> {
  return (await discoverPackagesWithDiagnostics(options)).packages;
}

/** Result of package discovery including non-node diagnostics. */
export interface DiscoverPackagesResult {
  /** Discovered package nodes. */
  packages: PackageNode[];
  /** Discovery diagnostics that do not fit on PackageNode. */
  diagnostics: TopologyDiscoveryDiagnostic[];
}

/** Discovers packages and reports fallback/ambiguity diagnostics. */
export async function discoverPackagesWithDiagnostics(options: DiscoverPackagesOptions): Promise<DiscoverPackagesResult> {
  const manifestPaths = findPackageManifestPaths(options.files, options.workspace);
  const diagnostics: TopologyDiscoveryDiagnostic[] = [];
  const packages = await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      const packagePath = dirname(manifestPath);
      const manifestName = await readPackageManifestName(options.rootPath, manifestPath);
      const name = manifestName ?? fallbackPackageName(packagePath);
      if (!manifestName) {
        diagnostics.push(discoveryDiagnostic("Package manifest name unavailable; path-based package name fallback used.", "medium", manifestPath));
      }
      return {
        packageId: createPackageId({ repoId: options.repoId, path: packagePath }),
        repoId: options.repoId,
        name,
        path: packagePath,
        manifestPath
      };
    })
  );

  const uniquePackages = assertUniquePackages(packages);
  collectDuplicateNameDiagnostics(uniquePackages, diagnostics);
  return {
    packages: uniquePackages.sort((left, right) => left.path.localeCompare(right.path)),
    diagnostics
  };
}

/** Finds package manifest paths matching workspace package globs. */
export function findPackageManifestPaths(
  files: readonly FileEntry[],
  workspace: Pick<WorkspaceConfig, "packageGlobs" | "packageManifestFiles">
): string[] {
  const manifestNames = new Set(workspace.packageManifestFiles);
  return files
    .filter((file) => file.type === "file")
    .map((file) => normalizeRepoPath(file.path))
    .filter((path) => manifestNames.has(basename(path)))
    .filter((path) => workspace.packageGlobs.some((glob) => isMatch(dirname(path), glob)))
    .sort((left, right) => left.localeCompare(right));
}

async function readPackageManifestName(rootPath: string, manifestPath: string): Promise<string | undefined> {
  if (basename(manifestPath) !== "package.json") {
    return undefined;
  }

  try {
    const content = await Bun.file(join(rootPath, manifestPath)).text();
    const parsed = JSON.parse(content) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

function fallbackPackageName(packagePath: string): string {
  return basename(packagePath) || "root";
}

function assertUniquePackages(packages: PackageNode[]): PackageNode[] {
  const byPath = new Map<string, PackageNode>();
  const byId = new Map<string, PackageNode>();
  for (const packageNode of packages) {
    const existingPath = byPath.get(packageNode.path);
    if (existingPath && existingPath.manifestPath !== packageNode.manifestPath) {
      throw new InconsistentPackageDiscoveryError("Multiple package manifests resolved to the same package path.", {
        path: packageNode.path,
        manifests: [existingPath.manifestPath, packageNode.manifestPath]
      });
    }
    const existingId = byId.get(packageNode.packageId);
    if (existingId && existingId.path !== packageNode.path) {
      throw new TopologyIdCollisionError("Distinct package paths produced the same package ID.", {
        packageId: packageNode.packageId,
        paths: [existingId.path, packageNode.path]
      });
    }
    byPath.set(packageNode.path, packageNode);
    byId.set(packageNode.packageId, packageNode);
  }
  return [...byPath.values()];
}

function collectDuplicateNameDiagnostics(
  packages: readonly PackageNode[],
  diagnostics: TopologyDiscoveryDiagnostic[]
): void {
  const byName = new Map<string, PackageNode[]>();
  for (const packageNode of packages) {
    byName.set(packageNode.name, [...(byName.get(packageNode.name) ?? []), packageNode]);
  }
  for (const [name, packageNodes] of byName) {
    if (packageNodes.length > 1) {
      diagnostics.push(
        discoveryDiagnostic(
          `Duplicate package name "${name}" found across ${packageNodes.length} package paths; path-derived IDs preserve uniqueness.`,
          "medium"
        )
      );
    }
  }
}
