import {
	IndexerBuildError,
	serializeIndexerDiagnosticCause,
} from "../errors/indexer-errors";
import { collectAffectedDocs } from "../incremental/collect-affected-docs";
import { planIncrementalBuild } from "../incremental/plan-incremental-build";
import { createBuildReport } from "../reports/build-report";
import type {
	IndexerDependencies,
	IndexerSourceDiagnostic,
} from "../services/create-indexer-services";
import { computeSourceUpdates } from "../sync/compute-source-updates";
import type {
	BuildOptions,
	BuildReport,
	IndexerDiagnostic,
	OperationRecovery,
	OperationTimings,
} from "../types/indexer.types";
import { persistBuildResults } from "./persist-build-results";
import { rebuildDocs } from "./rebuild-docs";

/** Runs the complete build pipeline for one repository. */
export async function buildRepo(
	repoId: string,
	options: Omit<BuildOptions, "repoIds" | "all">,
	deps: IndexerDependencies,
): Promise<BuildReport> {
	const startedAt = Date.now();
	const repo = deps.resolveRepo(repoId);
	let sourceDiagnostics: IndexerSourceDiagnostic[] = [];
	let docsConsideredBeforeFailure = 0;
	try {
		const diagnosticsResult = await deps.withDiagnostics(async () => {
			const manifest = deps.store.manifests.get(repo.repoId);
			const storedRepo = deps.store.repos.get(repo.repoId);
			const update = await computeSourceUpdates(repo, deps, {
				baselineRevision: manifest?.indexedRevision ?? storedRepo?.revision,
			});
			const plan = planIncrementalBuild({
				repoId: repo.repoId,
				update,
				manifest,
				storeSchemaVersion: deps.storeSchemaVersion,
				compilerVersion: deps.compilerVersion,
				force: options.force,
				selection: options.selection,
			});

			if (plan.strategy === "noop") {
				return {
					update,
					plan,
					affected: undefined,
					artifacts: undefined,
					persisted: undefined,
				};
			}

			const affected = await collectAffectedDocs(repo, plan, deps);
			docsConsideredBeforeFailure = affected.selectedDocs.length;
			const artifacts = await rebuildDocs(
				repo,
				affected,
				update.currentRevision,
				deps,
			);
			let persisted;
			try {
				persisted = persistBuildResults(
					repo,
					{
						currentRevision: update.currentRevision,
						strategy: plan.strategy,
						partial: plan.partial,
						selection: options.selection,
						artifacts,
					},
					deps,
				);
			} catch (cause) {
				throw new IndexerBuildError(
					`Failed to persist build results for ${repo.repoId}.`,
					{
						operation: "persistBuildResults",
						stage: "persistence",
						repoId: repo.repoId,
						cause,
					},
				);
			}
			return { update, plan, affected, artifacts, persisted };
		});
		sourceDiagnostics = diagnosticsResult.diagnostics;
		const { update, plan, artifacts, persisted } = diagnosticsResult.result;

		if (plan.strategy === "noop") {
			return createBuildReport({
				repoId: repo.repoId,
				strategy: "noop",
				reasonCode: plan.reasonCode,
				partial: false,
				reason: plan.reason,
				currentRevision: update.currentRevision,
				changedPaths: plan.affectedPaths,
				affectedDocPaths: plan.affectedDocPaths,
				deletedDocPaths: plan.deletedDocPaths,
				skippedDocPaths: [],
				diagnostics: sourceDiagnostics.map(toIndexerDiagnostic),
				recovery: {
					previousCorpusPreserved: true,
					stale: false,
					nextAction: "No recovery action required.",
				},
				timings: createTimings(startedAt),
			});
		}
		if (artifacts === undefined) {
			throw new TypeError(
				"Build artifacts were not produced for a non-noop build.",
			);
		}

		const selectedDocPaths = new Set(
			artifacts.selectedDocs.map((doc) => doc.classifiedDoc.path),
		);
		const skippedDocPaths =
			plan.strategy === "incremental" || plan.strategy === "targeted"
				? plan.affectedDocPaths.filter((path) => !selectedDocPaths.has(path))
				: [];

		return createBuildReport({
			repoId: repo.repoId,
			strategy: plan.strategy,
			reasonCode: plan.reasonCode,
			partial: plan.partial,
			reason: plan.reason,
			currentRevision: update.currentRevision,
			artifacts,
			persisted,
			changedPaths: plan.affectedPaths,
			affectedDocPaths: plan.affectedDocPaths,
			deletedDocPaths: plan.deletedDocPaths,
			skippedDocPaths,
			diagnostics: [
				...sourceDiagnostics.map(toIndexerDiagnostic),
				...collectBuildDiagnostics(plan.reason, artifacts),
			],
			recovery: {
				previousCorpusPreserved: true,
				stale: plan.partial,
				nextAction: plan.partial
					? "Run a full atlas build before treating the entire repo as fresh."
					: "No recovery action required.",
			},
			timings: createTimings(startedAt),
		});
	} catch (cause) {
		sourceDiagnostics = readCapturedDiagnostics(cause, sourceDiagnostics);
		const error =
			cause instanceof IndexerBuildError
				? cause
				: new IndexerBuildError(`Failed to build ${repoId}.`, {
						operation: "buildRepo",
						stage: "build",
						repoId,
						cause,
					});
		return createBuildReport({
			repoId,
			strategy: options.selection ? "targeted" : "full",
			reasonCode: options.selection ? "targeted_doc" : "source_full_rebuild",
			partial: options.selection !== undefined,
			reason: error.message,
			docsConsidered: docsConsideredBeforeFailure,
			diagnostics: [
				...sourceDiagnostics.map(toIndexerDiagnostic),
				{
					severity: "error",
					stage: error.context.stage ?? "build",
					message: error.message,
					code: error.name,
					...(error.context.entity === undefined
						? {}
						: { path: error.context.entity }),
					details: {
						operation: error.context.operation,
						repoId: error.context.repoId ?? repoId,
						...(error.context.entity === undefined
							? {}
							: { entity: error.context.entity }),
					},
					cause: serializeIndexerDiagnosticCause(error, { includeStack: true }),
				},
			],
			recovery: recoveryForRepoState(
				repoId,
				deps,
				"Fix the build failure and rerun atlas build for this repo.",
			),
			timings: createTimings(startedAt),
			failed: true,
		});
	}
}

function toIndexerDiagnostic(
	event: IndexerSourceDiagnostic,
): IndexerDiagnostic {
	return {
		severity: "warning",
		stage: "source",
		message: `${event.source} ${event.type}`,
		code: event.type,
		...(event.details === undefined ? {} : { details: event.details }),
	};
}

function recoveryForRepoState(
	repoId: string,
	deps: IndexerDependencies,
	nextAction: string,
): OperationRecovery {
	const repo = deps.store.repos.get(repoId);
	const manifest = deps.store.manifests.get(repoId);
	return {
		previousCorpusPreserved: true,
		stale:
			manifest?.indexedRevision !== undefined && repo?.revision !== undefined
				? manifest.indexedRevision !== repo.revision
				: true,
		nextAction,
	};
}

function collectBuildDiagnostics(
	reason: string,
	artifacts: Awaited<ReturnType<typeof rebuildDocs>>,
): IndexerDiagnostic[] {
	const diagnostics: IndexerDiagnostic[] = [
		{
			severity: "warning",
			stage: "planning",
			message: reason,
		},
	];
	for (const rebuilt of artifacts.selectedDocs) {
		diagnostics.push(
			...rebuilt.compilerDiagnostics.map((diagnostic) => ({
				severity: "warning" as const,
				stage: diagnostic.stage,
				message: diagnostic.message,
				code: diagnostic.code,
				...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
			})),
		);
	}
	return diagnostics;
}

function createTimings(startedAt: number): OperationTimings {
	const completedAt = Date.now();
	return {
		startedAt: new Date(startedAt).toISOString(),
		completedAt: new Date(completedAt).toISOString(),
		durationMs: completedAt - startedAt,
	};
}

function readCapturedDiagnostics(
	cause: unknown,
	fallback: IndexerSourceDiagnostic[],
): IndexerSourceDiagnostic[] {
	const captured = (cause as { __indexerDiagnostics?: unknown } | undefined)
		?.__indexerDiagnostics;
	return Array.isArray(captured)
		? (captured as IndexerSourceDiagnostic[])
		: fallback;
}
