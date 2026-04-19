import type { ManifestRecord } from "@atlas/store";

import { IndexerIncrementalBuildError } from "../errors/indexer-errors";
import type {
	BuildReasonCode,
	BuildSelection,
	IncrementalBuildPlan,
	SourceUpdate,
} from "../types/indexer.types";

/** Plans the minimal safe build strategy for one repository revision. */
export function planIncrementalBuild(input: {
	repoId: string;
	update: SourceUpdate;
	manifest?: ManifestRecord | undefined;
	storeSchemaVersion: number;
	compilerVersion: string;
	force?: boolean | undefined;
	selection?: BuildSelection | undefined;
}): IncrementalBuildPlan {
	try {
		validateSelection(input.selection);
		const compatibility = incompatibleReasonCode(
			input.manifest,
			input.storeSchemaVersion,
			input.compilerVersion,
		);
		if (input.selection !== undefined) {
			const reasonCode = selectionReasonCode(input.selection);
			return {
				repoId: input.repoId,
				strategy: "targeted",
				reasonCode,
				reason: buildSelectionReason(input.selection, input.force === true),
				currentRevision: input.update.currentRevision,
				manifest: input.manifest,
				selection: input.selection,
				affectedPaths: input.update.relevantChanges.map(
					(change) => change.path,
				),
				affectedDocPaths: input.selection.docIds ?? [],
				deletedDocPaths: [],
				partial: true,
			};
		}

		if (input.force === true) {
			return fullPlan(input, "force", "Forced rebuild requested.");
		}
		if (input.update.fullRebuildRequired === true) {
			return fullPlan(
				input,
				"source_full_rebuild",
				input.update.fullRebuildReason ??
					"Source adapter required a full rebuild.",
			);
		}
		if (compatibility) {
			return fullPlan(input, compatibility.reasonCode, compatibility.reason);
		}
		if (
			!input.update.changed &&
			input.manifest?.indexedRevision === input.update.currentRevision
		) {
			return {
				repoId: input.repoId,
				strategy: "noop",
				reasonCode: "noop_current",
				reason: `Indexed revision ${input.update.currentRevision} is already current.`,
				currentRevision: input.update.currentRevision,
				manifest: input.manifest,
				affectedPaths: [],
				affectedDocPaths: [],
				deletedDocPaths: [],
				partial: false,
			};
		}
		if (input.update.topologySensitivePaths.length > 0) {
			return fullPlan(
				input,
				"topology_changed",
				"Topology-sensitive paths changed.",
			);
		}
		if (input.update.packageManifestPaths.length > 0) {
			return fullPlan(
				input,
				"package_manifest_changed",
				"Workspace package manifest paths changed.",
			);
		}

		const affectedDocPaths = input.update.relevantDocPaths;
		return {
			repoId: input.repoId,
			strategy: "incremental",
			reasonCode:
				affectedDocPaths.length > 0 ? "doc_changes" : "verification_only",
			reason:
				affectedDocPaths.length > 0
					? `Incremental rebuild for ${affectedDocPaths.length} affected documentation path(s).`
					: "Source revision changed with no mapped documentation paths; incremental verification run.",
			currentRevision: input.update.currentRevision,
			manifest: input.manifest,
			affectedPaths: input.update.relevantChanges.map((change) => change.path),
			affectedDocPaths,
			deletedDocPaths: collectDeletedDocPaths(input.update.relevantChanges),
			partial: false,
		};
	} catch (cause) {
		if (cause instanceof TypeError) {
			throw cause;
		}
		throw new IndexerIncrementalBuildError(
			`Failed to plan build for ${input.repoId}.`,
			{
				operation: "planIncrementalBuild",
				stage: "planning",
				repoId: input.repoId,
				cause,
			},
		);
	}
}

function incompatibleReasonCode(
	manifest: ManifestRecord | undefined,
	storeSchemaVersion: number,
	compilerVersion: string,
): { reasonCode: BuildReasonCode; reason: string } | undefined {
	if (manifest === undefined) {
		return {
			reasonCode: "missing_manifest",
			reason: "No manifest exists for this repository.",
		};
	}
	if (manifest.schemaVersion !== storeSchemaVersion) {
		return {
			reasonCode: "schema_mismatch",
			reason: `Manifest schema version ${manifest.schemaVersion} does not match store schema version ${storeSchemaVersion}.`,
		};
	}
	if (manifest.compilerVersion !== compilerVersion) {
		return {
			reasonCode: "compiler_mismatch",
			reason: `Manifest compiler version ${manifest.compilerVersion ?? "undefined"} does not match compiler version ${compilerVersion}.`,
		};
	}
	return undefined;
}

function fullPlan(
	input: {
		repoId: string;
		update: SourceUpdate;
		manifest?: ManifestRecord | undefined;
	},
	reasonCode: BuildReasonCode,
	reason: string,
): IncrementalBuildPlan {
	return {
		repoId: input.repoId,
		strategy: "full",
		reasonCode,
		reason,
		currentRevision: input.update.currentRevision,
		manifest: input.manifest,
		affectedPaths: input.update.relevantChanges.map((change) => change.path),
		affectedDocPaths: [],
		deletedDocPaths: [],
		partial: false,
	};
}

function collectDeletedDocPaths(
	changes: SourceUpdate["relevantChanges"],
): string[] {
	return [
		...new Set(
			changes.flatMap((change) => {
				if (change.normalizedKind === "deleted") {
					return [change.path];
				}
				if (
					change.rawKind === "renamed" &&
					change.oldPath !== undefined &&
					change.oldPath !== change.path
				) {
					return [change.oldPath];
				}
				return [];
			}),
		),
	].sort((left, right) => left.localeCompare(right));
}

function validateSelection(selection: BuildSelection | undefined): void {
	if (selection === undefined) {
		return;
	}
	const modes = [
		selection.docIds && selection.docIds.length > 0,
		selection.packageId !== undefined,
		selection.moduleId !== undefined,
	].filter(Boolean);
	if (modes.length === 0) {
		throw new TypeError(
			"Build selection must include docIds, packageId, or moduleId.",
		);
	}
	if (modes.length > 1) {
		throw new TypeError("Build selection must use exactly one selector mode.");
	}
}

function selectionReasonCode(selection: BuildSelection): BuildReasonCode {
	if (selection.docIds && selection.docIds.length > 0) {
		return "targeted_doc";
	}
	if (selection.packageId) {
		return "targeted_package";
	}
	return "targeted_module";
}

function buildSelectionReason(
	selection: BuildSelection,
	forced: boolean,
): string {
	const prefix = forced ? "Forced targeted rebuild" : "Targeted rebuild";
	if (selection.docIds && selection.docIds.length > 0) {
		return `${prefix} for ${selection.docIds.length} document ID(s).`;
	}
	if (selection.packageId) {
		return `${prefix} for package ${selection.packageId}.`;
	}
	return `${prefix} for module ${selection.moduleId}.`;
}
