import { createSyncBatchReport } from "../reports/sync-report";
import type { IndexerDependencies } from "../services/create-indexer-services";
import type { OperationTimings, SyncBatchReport, SyncOptions } from "../types/indexer.types";
import { syncRepo } from "./sync-repo";

/** Syncs multiple repositories while preserving per-repo outcomes. */
export async function syncAll(options: SyncOptions, deps: IndexerDependencies): Promise<SyncBatchReport> {
  const startedAt = Date.now();
  const repoIds = resolveRepoIds(options, deps);
  // Shared SQLite client is not concurrent-safe across nested transactions.
  // Keep multi-repo sync sequential so each repo owns the connection.
  const reports = [];
  for (const repoId of repoIds) {
    reports.push(await syncRepo(repoId, deps));
  }
  return createSyncBatchReport(repoIds, reports, createTimings(startedAt));
}

function resolveRepoIds(options: SyncOptions, deps: IndexerDependencies): string[] {
  if (options.all === true) {
    return deps.listRepos().map((repo) => repo.repoId);
  }
  if (options.repoIds && options.repoIds.length > 0) {
    return [...new Set(options.repoIds)];
  }
  return deps.listRepos().map((repo) => repo.repoId);
}

function createTimings(startedAt: number): OperationTimings {
  const completedAt = Date.now();
  return {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt
  };
}
