import { IndexerBuildError } from "../errors/indexer-errors";
import { createBuildBatchReport } from "../reports/build-report";
import type { BuildBatchReport, BuildOptions, OperationTimings } from "../types/indexer.types";
import type { IndexerDependencies } from "../services/create-indexer-services";
import { buildRepo } from "./build-repo";

/** Builds one or many repositories while preserving per-repo results. */
export async function buildAll(options: Omit<BuildOptions, "repoIds">, deps: IndexerDependencies): Promise<BuildBatchReport>;
export async function buildAll(options: BuildOptions, deps: IndexerDependencies): Promise<BuildBatchReport>;
export async function buildAll(options: BuildOptions, deps: IndexerDependencies): Promise<BuildBatchReport> {
  const startedAt = Date.now();
  validateMultiRepoOptions(options);
  const repoIds = resolveRepoIds(options, deps);
  const reports = await Promise.all(
    repoIds.map((repoId) =>
      buildRepo(
        repoId,
        {
          force: options.force,
          ...(options.selection === undefined ? {} : { selection: options.selection })
        },
        deps
      )
    )
  );
  return createBuildBatchReport(repoIds, reports, createTimings(startedAt));
}

function resolveRepoIds(options: BuildOptions, deps: IndexerDependencies): string[] {
  if (options.all === true) {
    return deps.listRepos().map((repo) => repo.repoId);
  }
  if (options.repoIds && options.repoIds.length > 0) {
    return [...new Set(options.repoIds)];
  }
  return deps.listRepos().map((repo) => repo.repoId);
}

function validateMultiRepoOptions(options: BuildOptions): void {
  const repoCount = options.repoIds?.length ?? 0;
  if (options.selection !== undefined && (options.all === true || repoCount !== 1)) {
    throw new IndexerBuildError("Targeted build selectors require exactly one repository target.", {
      operation: "buildAll",
      stage: "targeting"
    });
  }
}

function createTimings(startedAt: number): OperationTimings {
  const completedAt = Date.now();
  return {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt
  };
}
