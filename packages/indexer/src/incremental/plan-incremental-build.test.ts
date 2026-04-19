import { describe, expect, test } from "bun:test";
import type { ManifestRecord } from "@atlas/store";
import type { SourceUpdate } from "../types/indexer.types";
import { planIncrementalBuild } from "./plan-incremental-build";

const repoId = "repo-a";
const currentRevision = "rev-2";

function manifest(overrides: Partial<ManifestRecord> = {}): ManifestRecord {
	return {
		repoId,
		indexedRevision: currentRevision,
		buildTimestamp: "2026-01-01T00:00:00.000Z",
		schemaVersion: 1,
		compilerVersion: "compiler-1",
		...overrides,
	};
}

function update(overrides: Partial<SourceUpdate> = {}): SourceUpdate {
	return {
		repoId,
		mode: "local-git",
		previousRevision: "rev-1",
		currentRevision,
		changed: false,
		changes: [],
		relevantChanges: [],
		relevantDocPaths: [],
		topologySensitivePaths: [],
		packageManifestPaths: [],
		timings: {
			startedAt: "2026-01-01T00:00:00.000Z",
			completedAt: "2026-01-01T00:00:00.000Z",
			durationMs: 0,
		},
		...overrides,
	};
}

function plan(input: Partial<Parameters<typeof planIncrementalBuild>[0]> = {}) {
	return planIncrementalBuild({
		repoId,
		update: update(),
		manifest: manifest(),
		storeSchemaVersion: 1,
		compilerVersion: "compiler-1",
		...input,
	});
}

describe("planIncrementalBuild", () => {
	test("returns noop for current manifest", () => {
		expect(plan()).toMatchObject({
			strategy: "noop",
			reasonCode: "noop_current",
		});
	});

	test("returns full rebuild reasons", () => {
		expect(plan({ force: true })).toMatchObject({
			strategy: "full",
			reasonCode: "force",
		});
		expect(plan({ manifest: undefined })).toMatchObject({
			strategy: "full",
			reasonCode: "missing_manifest",
		});
		expect(plan({ manifest: manifest({ schemaVersion: 0 }) })).toMatchObject({
			strategy: "full",
			reasonCode: "schema_mismatch",
		});
		expect(
			plan({ manifest: manifest({ compilerVersion: "old" }) }),
		).toMatchObject({ strategy: "full", reasonCode: "compiler_mismatch" });
		expect(
			plan({
				update: update({
					fullRebuildRequired: true,
					fullRebuildReason:
						"GHES compare response could not provide trustworthy file-level changes; full rebuild required.",
				}),
			}),
		).toMatchObject({ strategy: "full", reasonCode: "source_full_rebuild" });
		expect(
			plan({
				update: update({
					changed: true,
					topologySensitivePaths: ["package.json"],
				}),
			}),
		).toMatchObject({ strategy: "full", reasonCode: "topology_changed" });
		expect(
			plan({
				update: update({
					changed: true,
					packageManifestPaths: ["packages/app/package.json"],
				}),
			}),
		).toMatchObject({
			strategy: "full",
			reasonCode: "package_manifest_changed",
		});
	});

	test("returns incremental doc and verification reasons with deletes", () => {
		expect(
			plan({
				update: update({
					changed: true,
					relevantChanges: [
						{
							rawKind: "modified",
							normalizedKind: "modified",
							path: "docs/a.md",
						},
					],
					relevantDocPaths: ["docs/a.md"],
				}),
			}),
		).toMatchObject({
			strategy: "incremental",
			reasonCode: "doc_changes",
			affectedDocPaths: ["docs/a.md"],
		});
		expect(plan({ update: update({ changed: true }) })).toMatchObject({
			strategy: "incremental",
			reasonCode: "verification_only",
		});
		expect(
			plan({
				update: update({
					changed: true,
					relevantChanges: [
						{
							rawKind: "renamed",
							normalizedKind: "renamed",
							oldPath: "docs/old.md",
							path: "docs/new.md",
						},
					],
					relevantDocPaths: ["docs/new.md", "docs/old.md"],
				}),
			}).deletedDocPaths,
		).toEqual(["docs/old.md"]);
	});

	test("returns targeted reasons before manifest compatibility checks", () => {
		expect(
			plan({
				manifest: undefined,
				selection: { docIds: ["doc_repo-a_docs/a.md"] },
			}),
		).toMatchObject({
			strategy: "targeted",
			reasonCode: "targeted_doc",
			affectedDocPaths: ["doc_repo-a_docs/a.md"],
		});
		expect(plan({ selection: { packageId: "pkg-a" } })).toMatchObject({
			strategy: "targeted",
			reasonCode: "targeted_package",
		});
		expect(plan({ selection: { moduleId: "mod-a" } })).toMatchObject({
			strategy: "targeted",
			reasonCode: "targeted_module",
		});
	});

	test("rejects invalid selectors with exact messages", () => {
		expect(() => plan({ selection: {} })).toThrow(
			"Build selection must include docIds, packageId, or moduleId.",
		);
		expect(() =>
			plan({
				selection: { docIds: ["doc_repo-a_docs/a.md"], packageId: "pkg-a" },
			}),
		).toThrow("Build selection must use exactly one selector mode.");
	});
});
