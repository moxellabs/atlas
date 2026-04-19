import { filterRelevantPaths, type RelevantPathFilters, type RepoCacheService } from "@atlas/source-git";
import type { RepoConfig } from "@atlas/core";
import { GhesDiffError } from "@atlas/source-ghes";
import { isMatch } from "@atlas/topology";

import { IndexerSyncError } from "../errors/indexer-errors";
import type { IndexerDependencies } from "../services/create-indexer-services";
import type { OperationTimings, SourceUpdate } from "../types/indexer.types";

/** Computes source changes for an explicit revision range without mutating store state. */
export async function computeSourceDiff(repo: RepoConfig, deps: IndexerDependencies, fromRevision: string, toRevision: string): Promise<SourceUpdate> {
  const startedAt = Date.now();
  try {
    const sourceAdapter = deps.getSourceAdapter(repo);
    const diffResult =
      fromRevision === toRevision
        ? { changes: [], fullRebuildRequired: false }
        : await computeChangedPaths(repo, sourceAdapter, fromRevision, toRevision);
    return createSourceUpdate({
      repo,
      previousRevision: fromRevision,
      currentRevision: toRevision,
      changed: fromRevision !== toRevision,
      diffResult,
      startedAt
    });
  } catch (cause) {
    throw new IndexerSyncError(`Failed to compute source diff for ${repo.repoId}.`, {
      operation: "computeSourceDiff",
      stage: "source",
      repoId: repo.repoId,
      cause
    });
  }
}

/** Computes normalized source update state for one repository. */
export async function computeSourceUpdates(repo: RepoConfig, deps: IndexerDependencies, options: { baselineRevision?: string | undefined } = {}): Promise<SourceUpdate> {
  const startedAt = Date.now();
  try {
    const sourceAdapter = deps.getSourceAdapter(repo);
    const previousRevision = options.baselineRevision ?? deps.store.repos.get(repo.repoId)?.revision;
    const managedSource = deps.getManagedSourceAdapter(repo);

    if (repo.mode === "local-git" && "updateCache" in managedSource) {
      await (managedSource as RepoCacheService).updateCache(repo);
    }

    const current = await sourceAdapter.getRevision(repo);
    const changed = previousRevision !== undefined && previousRevision !== current.revision;
    const diffResult =
      !changed || previousRevision === undefined
        ? { changes: [], fullRebuildRequired: false }
        : await computeChangedPaths(repo, sourceAdapter, previousRevision, current.revision);
    return createSourceUpdate({
      repo,
      previousRevision,
      currentRevision: current.revision,
      changed,
      diffResult,
      startedAt
    });
  } catch (cause) {
    throw new IndexerSyncError(`Failed to compute source updates for ${repo.repoId}.`, {
      operation: "computeSourceUpdates",
      stage: "source",
      repoId: repo.repoId,
      cause
    });
  }
}

function createSourceUpdate(input: {
  repo: RepoConfig;
  previousRevision?: string | undefined;
  currentRevision: string;
  changed: boolean;
  diffResult: { changes: SourceUpdate["changes"]; fullRebuildRequired: boolean; fullRebuildReason?: string | undefined };
  startedAt: number;
}): SourceUpdate {
  const changes = input.diffResult.changes;
  const filters = buildRelevantPathFilters(input.repo);
  const relevantChanges = filterRelevantPaths(changes, filters);
  const relevantDocPaths = collectRelevantDocPaths(relevantChanges);
  const topologySensitivePaths = collectTopologySensitivePaths(input.repo, changes);
  const packageManifestPaths = collectPackageManifestPaths(input.repo, relevantChanges);

  return {
    repoId: input.repo.repoId,
    mode: input.repo.mode,
    ...(input.previousRevision === undefined ? {} : { previousRevision: input.previousRevision }),
    currentRevision: input.currentRevision,
    changed: input.changed,
    changes,
    relevantChanges,
    relevantDocPaths,
    topologySensitivePaths,
    packageManifestPaths,
    ...(input.diffResult.fullRebuildRequired
      ? {
          fullRebuildRequired: true,
          fullRebuildReason: input.diffResult.fullRebuildReason
        }
      : {}),
    timings: createTimings(input.startedAt)
  };
}

async function computeChangedPaths(
  repo: RepoConfig,
  sourceAdapter: ReturnType<IndexerDependencies["getSourceAdapter"]>,
  previousRevision: string,
  currentRevision: string
): Promise<{ changes: SourceUpdate["changes"]; fullRebuildRequired: boolean; fullRebuildReason?: string | undefined }> {
  try {
    return {
      changes: await sourceAdapter.diffPaths(repo, previousRevision, currentRevision),
      fullRebuildRequired: false
    };
  } catch (cause) {
    if (repo.mode === "ghes-api" && cause instanceof GhesDiffError && isUnsafeGhesDiffShape(cause)) {
      return {
        changes: [],
        fullRebuildRequired: true,
        fullRebuildReason: "GHES compare response could not provide trustworthy file-level changes; full rebuild required."
      };
    }
    throw cause;
  }
}

function isUnsafeGhesDiffShape(error: GhesDiffError): boolean {
  return error.context.operation === "readCompareFiles" || error.context.operation === "toSourceChange";
}

function buildRelevantPathFilters(repo: RepoConfig): RelevantPathFilters {
  const packageManifests = repo.workspace.packageManifestFiles.map((manifest) => `**/${manifest}`);
  const topologyPatterns = repo.topology.flatMap((rule) => [
    ...rule.match.include,
    ...(rule.ownership.packageRootPattern ? [rule.ownership.packageRootPattern] : []),
    ...(rule.ownership.moduleRootPattern ? [rule.ownership.moduleRootPattern] : []),
    ...(rule.ownership.skillPattern ? [rule.ownership.skillPattern] : [])
  ]);

  return {
    include: [
      ...new Set([
        "docs/**/*.md",
        "skills/**/*.md",
        "**/docs/**/*.md",
        "skills/**/{scripts,references,agents}/**",
        "**/docs/**/{scripts,references,agents}/**",
        ...packageManifests,
        ...topologyPatterns
      ])
    ]
  };
}

function collectRelevantDocPaths(changes: SourceUpdate["relevantChanges"]): string[] {
  return [...new Set(changes.flatMap((change) => collectCandidatePaths(change).filter(isDocumentationPath)))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function collectTopologySensitivePaths(repo: RepoConfig, changes: SourceUpdate["changes"]): string[] {
  const ownershipPatterns = repo.topology.flatMap((rule) => [
    ...(rule.ownership.packageRootPattern ? [rule.ownership.packageRootPattern] : []),
    ...(rule.ownership.moduleRootPattern ? [rule.ownership.moduleRootPattern] : []),
    ...(rule.ownership.skillPattern ? [rule.ownership.skillPattern] : [])
  ]);

  return [
    ...new Set(
      changes
        .flatMap((change) => collectCandidatePaths(change))
        .filter((path) => (ownershipPatterns.some((pattern) => isMatch(path, pattern)) && !isDocumentationPath(path)) || isSkillArtifactPath(path))
    )
  ].sort((left, right) => left.localeCompare(right));
}

function collectPackageManifestPaths(repo: RepoConfig, changes: SourceUpdate["relevantChanges"]): string[] {
  const packageManifests = new Set(repo.workspace.packageManifestFiles);
  return [...new Set(changes.flatMap((change) => collectCandidatePaths(change)).filter((path) => packageManifests.has(baseName(path))))]
    .sort((left, right) => left.localeCompare(right));
}

function collectCandidatePaths(change: SourceUpdate["relevantChanges"][number]): string[] {
  return change.oldPath ? [change.path, change.oldPath] : [change.path];
}

function isDocumentationPath(path: string): boolean {
  return path.endsWith(".md") && (path.startsWith("docs/") || path.startsWith("skills/") || path.includes("/docs/"));
}

function isSkillArtifactPath(path: string): boolean {
  return (
    (path.startsWith("skills/") || path.includes("/docs/")) &&
    (path.includes("/scripts/") || path.includes("/references/") || path.includes("/agents/"))
  );
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function createTimings(startedAt: number): OperationTimings {
  const completedAt = Date.now();
  return {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt
  };
}
