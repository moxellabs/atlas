import type { PackageNode } from "@atlas/core";

import { StoreRepositoryError } from "../errors";
import type { PackageRecord, StoreDatabase } from "../types";

/** Persists and queries discovered package nodes. */
export class PackageRepository {
  constructor(private readonly db: StoreDatabase) {}

  /** Inserts or updates one package node. */
  upsert(pkg: PackageNode): PackageRecord {
    this.withRepositoryErrors("upsertPackage", () => {
      this.db.run(
        `INSERT INTO packages (package_id, repo_id, name, path, manifest_path)
         VALUES ($packageId, $repoId, $name, $path, $manifestPath)
         ON CONFLICT(package_id) DO UPDATE SET
           repo_id = excluded.repo_id,
           name = excluded.name,
           path = excluded.path,
           manifest_path = excluded.manifest_path`,
        {
          $packageId: pkg.packageId,
          $repoId: pkg.repoId,
          $name: pkg.name,
          $path: pkg.path,
          $manifestPath: pkg.manifestPath
        }
      );
    });
    return pkg;
  }

  /** Replaces all package nodes for one repo. */
  replaceForRepo(repoId: string, packages: readonly PackageNode[]): void {
    this.withRepositoryErrors("replacePackagesForRepo", () => {
      this.db.transaction(() => {
        this.db.run("DELETE FROM packages WHERE repo_id = $repoId", { $repoId: repoId });
        for (const pkg of packages) {
          this.upsert(pkg);
        }
      });
    });
  }

  /** Lists packages by repository in deterministic path order. */
  listByRepo(repoId: string): PackageRecord[] {
    return this.withRepositoryErrors("listPackagesByRepo", () =>
      this.db
        .all<PackageRow>(
          "SELECT package_id, repo_id, name, path, manifest_path FROM packages WHERE repo_id = $repoId ORDER BY path",
          { $repoId: repoId }
        )
        .map(mapPackageRow)
    );
  }

  /** Returns a package by ID. */
  get(packageId: string): PackageRecord | undefined {
    return this.withRepositoryErrors("getPackage", () => {
      const row = this.db.get<PackageRow>(
        "SELECT package_id, repo_id, name, path, manifest_path FROM packages WHERE package_id = $packageId",
        { $packageId: packageId }
      );
      return row === undefined ? undefined : mapPackageRow(row);
    });
  }

  private withRepositoryErrors<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw new StoreRepositoryError("Package persistence operation failed.", {
        operation,
        entity: "package",
        cause: error
      });
    }
  }
}

interface PackageRow {
  package_id: string;
  repo_id: string;
  name: string;
  path: string;
  manifest_path: string;
}

function mapPackageRow(row: PackageRow): PackageRecord {
  return {
    packageId: row.package_id,
    repoId: row.repo_id,
    name: row.name,
    path: row.path,
    manifestPath: row.manifest_path
  };
}
