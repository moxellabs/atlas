import type { RepoConfig } from "@atlas/core";
import type { ManifestRecord } from "@atlas/store";

import { IndexerSyncError } from "../errors/indexer-errors";
import { createSyncReport } from "../reports/sync-report";
import type { IndexerDependencies, IndexerSourceDiagnostic } from "../services/create-indexer-services";
import type { CorpusImpact, IndexerDiagnostic, OperationRecovery, OperationTimings, SourceUpdate, SyncReport } from "../types/indexer.types";
import { computeSourceUpdates } from "./compute-source-updates";

/** Syncs one repository source and persists source revision state only. */
export async function syncRepo(repoId: string, deps: IndexerDependencies): Promise<SyncReport> {
  const startedAt = Date.now();
  const repo = deps.resolveRepo(repoId);
  try {
    const storedRepo = deps.store.repos.get(repo.repoId);
    const manifest = deps.store.manifests.get(repo.repoId);
    const baselineRevision = manifest?.indexedRevision ?? storedRepo?.revision;
    const { result: update, diagnostics: sourceDiagnostics } = await deps.withDiagnostics(() =>
      computeSourceUpdates(repo, deps, { baselineRevision })
    );
    const sourceChanged = storedRepo?.revision !== undefined ? storedRepo.revision !== update.currentRevision : update.changed;
    deps.store.repos.upsert({
      repoId: repo.repoId,
      mode: repo.mode,
      revision: update.currentRevision
    });
    const corpusImpact = computeCorpusImpact(update, manifest, deps);
    const corpusAffected = corpusImpact !== "none";
    if (!corpusAffected && manifest !== undefined && manifest.indexedRevision !== update.currentRevision) {
      deps.store.manifests.upsert({
        repoId: repo.repoId,
        indexedRevision: update.currentRevision,
        compilerVersion: manifest.compilerVersion ?? deps.compilerVersion,
        schemaVersion: manifest.schemaVersion
      });
    }

    return createSyncReport({
      repoId: repo.repoId,
      mode: repo.mode,
      update,
      sourceChanged,
      corpusImpact,
      diagnostics: [...sourceDiagnostics.map(toIndexerDiagnostic), ...createSyncDiagnostics(repo, update)],
      recovery: {
        previousCorpusPreserved: true,
        stale: corpusAffected,
        nextAction: nextActionForCorpusImpact(corpusImpact)
      },
      timings: mergeTimings(startedAt, update.timings)
    });
  } catch (cause) {
    const error = cause instanceof IndexerSyncError ? cause : new IndexerSyncError(`Failed to sync ${repoId}.`, {
      operation: "syncRepo",
      stage: "sync",
      repoId,
      cause
    });

    return createSyncReport({
      repoId,
      mode: repo.mode,
      diagnostics: [
        {
          severity: "error",
          stage: error.context.stage ?? "sync",
          message: error.message,
          code: error.name
        }
      ],
      recovery: recoveryForRepoState(repo.repoId, deps, "Fix the sync failure and rerun atlas sync for this repo."),
      timings: completeTimings(startedAt),
      failed: true
    });
  }
}

function toIndexerDiagnostic(event: IndexerSourceDiagnostic): IndexerDiagnostic {
  return {
    severity: "warning",
    stage: "source",
    message: `${event.source} ${event.type}`,
    code: event.type,
    ...(event.details === undefined ? {} : { details: event.details })
  };
}

function recoveryForRepoState(repoId: string, deps: IndexerDependencies, nextAction: string): OperationRecovery {
  const repo = deps.store.repos.get(repoId);
  const manifest = deps.store.manifests.get(repoId);
  return {
    previousCorpusPreserved: true,
    stale: manifest?.indexedRevision !== undefined && repo?.revision !== undefined ? manifest.indexedRevision !== repo.revision : true,
    nextAction
  };
}

function computeCorpusImpact(update: SourceUpdate, manifest: ManifestRecord | undefined, deps: IndexerDependencies): CorpusImpact {
  if (manifest === undefined || manifest.indexedRevision === undefined) {
    return "missing-manifest";
  }
  if (manifest.schemaVersion !== deps.storeSchemaVersion || manifest.compilerVersion !== deps.compilerVersion) {
    return "incompatible-manifest";
  }
  if (update.fullRebuildRequired === true) {
    return "full-rebuild";
  }
  if (update.topologySensitivePaths.length > 0) {
    return "topology";
  }
  if (update.packageManifestPaths.length > 0) {
    return "package-manifest";
  }
  if (update.relevantDocPaths.length > 0) {
    return "docs";
  }
  return "none";
}

function nextActionForCorpusImpact(impact: CorpusImpact): string {
  if (impact === "none") {
    return "No recovery action required.";
  }
  if (impact === "missing-manifest") {
    return "Run atlas build to create the indexed corpus.";
  }
  if (impact === "incompatible-manifest") {
    return "Run atlas build to refresh the corpus with the current compiler and store schema.";
  }
  return "Run atlas build to update the indexed corpus.";
}

function createSyncDiagnostics(repo: RepoConfig, update: Awaited<ReturnType<typeof computeSourceUpdates>>): IndexerDiagnostic[] {
  const diagnostics: IndexerDiagnostic[] = [];
  if (!update.changed) {
    diagnostics.push({
      severity: "warning",
      stage: "sync",
      message: `Repository ${repo.repoId} is already at revision ${update.currentRevision}.`
    });
  }
  if (update.relevantDocPaths.length === 0 && update.changed) {
    diagnostics.push({
      severity: "warning",
      stage: "source",
      message: "Source revision changed but no corpus-affecting documentation paths were affected."
    });
  }
  if (update.topologySensitivePaths.length > 0) {
    diagnostics.push({
      severity: "warning",
      stage: "source",
      message: `Topology-sensitive paths changed: ${update.topologySensitivePaths.join(", ")}.`
    });
  }
  return diagnostics;
}

function completeTimings(startedAt: number): OperationTimings {
  const completedAt = Date.now();
  return {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt
  };
}

function mergeTimings(startedAt: number, updateTimings: OperationTimings): OperationTimings {
  return {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: updateTimings.completedAt,
    durationMs: new Date(updateTimings.completedAt).getTime() - startedAt
  };
}
