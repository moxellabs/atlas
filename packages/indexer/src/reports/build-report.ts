import type {
	BuildBatchReport,
	BuildReasonCode,
	BuildReport,
	OperationRecovery,
	OperationTimings,
	PersistBuildResult,
	RebuildArtifacts,
} from "../types/indexer.types";

/** Creates a deterministic build report from plan, rebuild, and persistence outputs. */
export function createBuildReport(input: {
	repoId: string;
	strategy: BuildReport["strategy"];
	reasonCode: BuildReasonCode;
	partial: boolean;
	reason: string;
	currentRevision?: string | undefined;
	artifacts?: RebuildArtifacts | undefined;
	persisted?: PersistBuildResult | undefined;
	changedPaths?: string[] | undefined;
	affectedDocPaths?: string[] | undefined;
	deletedDocPaths?: string[] | undefined;
	skippedDocPaths?: string[] | undefined;
	diagnostics?: BuildReport["diagnostics"] | undefined;
	recovery?: OperationRecovery | undefined;
	timings: OperationTimings;
	failed?: boolean | undefined;
}): BuildReport {
	const diagnostics = input.diagnostics ?? [];
	const persisted = input.persisted;
	const docsRebuilt = input.artifacts?.selectedDocs.length ?? 0;
	const docsDeleted =
		persisted?.docsDeleted ?? input.artifacts?.deletedStoredDocIds.length ?? 0;
	const summariesUpdated = persisted?.summariesUpdated ?? 0;
	return {
		repoId: input.repoId,
		strategy: input.strategy,
		reasonCode: input.reasonCode,
		partial: input.partial,
		reason: input.reason,
		...(input.currentRevision === undefined
			? {}
			: { currentRevision: input.currentRevision }),
		docsConsidered: input.artifacts?.selectedDocs.length ?? 0,
		docsRebuilt,
		docsDeleted,
		chunksPersisted: persisted?.chunksPersisted ?? 0,
		skillsUpdated: persisted?.skillsUpdated ?? 0,
		summariesUpdated,
		manifestUpdated: input.failed !== true && persisted !== undefined,
		changedPaths: sortedUnique(input.changedPaths),
		affectedDocPaths: sortedUnique(input.affectedDocPaths),
		deletedDocPaths: sortedUnique(input.deletedDocPaths),
		skippedDocPaths: sortedUnique(input.skippedDocPaths),
		diagnostics,
		recovery:
			input.recovery ??
			(input.failed === true
				? {
						previousCorpusPreserved: true,
						stale: true,
						nextAction:
							"Fix the build failure and rerun atlas build for this repo.",
					}
				: {
						previousCorpusPreserved: true,
						stale: false,
						nextAction: input.partial
							? "Run a full atlas build before treating the entire repo as fresh."
							: "No recovery action required.",
					}),
		timings: input.timings,
	};
}

/** Creates an aggregate build batch report while preserving per-repo outcomes. */
export function createBuildBatchReport(
	requestedRepoIds: string[],
	reports: BuildReport[],
	timings: OperationTimings,
): BuildBatchReport {
	const failureCount = reports.filter((report) =>
		report.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
	).length;
	return {
		requestedRepoIds,
		reports,
		successCount: reports.length - failureCount,
		failureCount,
		timings,
	};
}

function sortedUnique(paths: string[] | undefined): string[] {
	return [...new Set(paths ?? [])].sort((left, right) =>
		left.localeCompare(right),
	);
}
