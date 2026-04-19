import type { ModuleNode } from "@atlas/core";

import { StoreRepositoryError } from "../errors";
import type { ModuleRecord, StoreDatabase } from "../types";

/** Persists and queries discovered module nodes. */
export class ModuleRepository {
  constructor(private readonly db: StoreDatabase) {}

  /** Inserts or updates one module node. */
  upsert(module: ModuleNode): ModuleRecord {
    this.withRepositoryErrors("upsertModule", () => {
      this.db.run(
        `INSERT INTO modules (module_id, repo_id, package_id, name, path)
         VALUES ($moduleId, $repoId, $packageId, $name, $path)
         ON CONFLICT(module_id) DO UPDATE SET
           repo_id = excluded.repo_id,
           package_id = excluded.package_id,
           name = excluded.name,
           path = excluded.path`,
        {
          $moduleId: module.moduleId,
          $repoId: module.repoId,
          $packageId: module.packageId ?? null,
          $name: module.name,
          $path: module.path
        }
      );
    });
    return module;
  }

  /** Replaces all module nodes for one repo. */
  replaceForRepo(repoId: string, modules: readonly ModuleNode[]): void {
    this.withRepositoryErrors("replaceModulesForRepo", () => {
      this.db.transaction(() => {
        this.db.run("DELETE FROM modules WHERE repo_id = $repoId", { $repoId: repoId });
        for (const module of modules) {
          this.upsert(module);
        }
      });
    });
  }

  /** Lists modules by repository and optional package in deterministic path order. */
  listByRepo(repoId: string, packageId?: string): ModuleRecord[] {
    return this.withRepositoryErrors("listModulesByRepo", () => {
      const rows =
        packageId === undefined
          ? this.db.all<ModuleRow>("SELECT module_id, repo_id, package_id, name, path FROM modules WHERE repo_id = $repoId ORDER BY path", {
              $repoId: repoId
            })
          : this.db.all<ModuleRow>(
              `SELECT module_id, repo_id, package_id, name, path
               FROM modules
               WHERE repo_id = $repoId AND package_id = $packageId
               ORDER BY path`,
              { $repoId: repoId, $packageId: packageId }
            );
      return rows.map(mapModuleRow);
    });
  }

  /** Returns a module by ID. */
  get(moduleId: string): ModuleRecord | undefined {
    return this.withRepositoryErrors("getModule", () => {
      const row = this.db.get<ModuleRow>("SELECT module_id, repo_id, package_id, name, path FROM modules WHERE module_id = $moduleId", {
        $moduleId: moduleId
      });
      return row === undefined ? undefined : mapModuleRow(row);
    });
  }

  private withRepositoryErrors<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw new StoreRepositoryError("Module persistence operation failed.", {
        operation,
        entity: "module",
        cause: error
      });
    }
  }
}

interface ModuleRow {
  module_id: string;
  repo_id: string;
  package_id: string | null;
  name: string;
  path: string;
}

function mapModuleRow(row: ModuleRow): ModuleRecord {
  return {
    moduleId: row.module_id,
    repoId: row.repo_id,
    ...(row.package_id === null ? {} : { packageId: row.package_id }),
    name: row.name,
    path: row.path
  };
}
