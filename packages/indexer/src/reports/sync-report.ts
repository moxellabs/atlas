import type { CorpusImpact, OperationRecovery, OperationTimings, SourceUpdate, SyncBatchReport, SyncReport } from "../types/indexer.types";

/** Creates a deterministic sync report from source update state and diagnostics. */
export function createSyncReport(input: {
  repoId: string;
  mode: "local-git" | "ghes-api";
  update?: SourceUpdate | undefined;
  sourceChanged?: boolean | undefined;
  corpusImpact?: CorpusImpact | undefined;
  diagnostics?: SyncReport["diagnostics"] | undefined;
  recovery?: OperationRecovery | undefined;
  timings: OperationTimings;
  failed?: boolean | undefined;
}): SyncReport {
  const diagnostics = input.diagnostics ?? [];
  const corpusImpact = input.corpusImpact ?? inferCorpusImpact(input.update, false);
  const corpusAffected = corpusImpact !== "none";
  return {
    repoId: input.repoId,
    mode: input.mode,
    status: input.failed === true ? "failed" : input.update?.changed === true ? "updated" : "unchanged",
    ...(input.update?.previousRevision === undefined ? {} : { previousRevision: input.update.previousRevision }),
    ...(input.update?.currentRevision === undefined ? {} : { currentRevision: input.update.currentRevision }),
    sourceChanged: input.sourceChanged ?? input.update?.changed === true,
    corpusAffected,
    corpusImpact,
    changedPathCount: input.update?.changes.length ?? 0,
    relevantChangedPathCount: input.update?.relevantChanges.length ?? 0,
    relevantDocPathCount: input.update?.relevantDocPaths.length ?? 0,
    topologySensitivePathCount: input.update?.topologySensitivePaths.length ?? 0,
    packageManifestPathCount: input.update?.packageManifestPaths.length ?? 0,
    diagnostics,
    recovery:
      input.recovery ??
      (input.failed === true
        ? {
            previousCorpusPreserved: true,
            stale: true,
            nextAction: "Fix the sync failure and rerun atlas sync for this repo."
          }
        : {
            previousCorpusPreserved: true,
            stale: corpusAffected,
            nextAction: corpusAffected ? "Run atlas build to update the indexed corpus." : "No recovery action required."
          }),
    timings: input.timings
  };
}

/** Creates an aggregate sync batch report while preserving per-repo detail. */
export function createSyncBatchReport(requestedRepoIds: string[], reports: SyncReport[], timings: OperationTimings): SyncBatchReport {
  const failureCount = reports.filter((report) => report.status === "failed").length;
  return {
    requestedRepoIds,
    reports,
    successCount: reports.length - failureCount,
    failureCount,
    timings
  };
}

function inferCorpusImpact(update: SourceUpdate | undefined, missingManifest: boolean): CorpusImpact {
  if (update?.fullRebuildRequired === true) {
    return "full-rebuild";
  }
  if (missingManifest) {
    return "missing-manifest";
  }
  if ((update?.topologySensitivePaths.length ?? 0) > 0) {
    return "topology";
  }
  if ((update?.packageManifestPaths.length ?? 0) > 0) {
    return "package-manifest";
  }
  if ((update?.relevantDocPaths.length ?? 0) > 0) {
    return "docs";
  }
  return "none";
}
