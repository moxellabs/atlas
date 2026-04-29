import { describe, expect, test } from "bun:test";

import { serializeIndexerDiagnosticCause } from "../errors/indexer-errors";
import { createBuildReport } from "./build-report";

describe("createBuildReport", () => {
	test("returns stable safe build diagnostics", () => {
		const report = createBuildReport({
			repoId: "repo-a",
			strategy: "incremental",
			reasonCode: "doc_changes",
			partial: false,
			reason: "Incremental rebuild for docs.",
			currentRevision: "rev-2",
			changedPaths: ["docs/b.md", "docs/a.md", "docs/a.md"],
			affectedDocPaths: ["docs/a.md", "docs/a.md"],
			deletedDocPaths: ["docs/old.md"],
			skippedDocPaths: ["docs/b.md"],
			diagnostics: [
				{
					severity: "warning",
					stage: "planning",
					message: "safe diagnostic",
					details: { path: "docs/a.md", revision: "rev-2" },
				},
			],
			timings: {
				startedAt: "2026-01-01T00:00:00.000Z",
				completedAt: "2026-01-01T00:00:00.000Z",
				durationMs: 0,
			},
		});

		expect(report.reasonCode).toBe("doc_changes");
		expect(report.changedPaths).toEqual(["docs/a.md", "docs/b.md"]);
		expect(report.affectedDocPaths).toEqual(["docs/a.md"]);
		expect(report.deletedDocPaths).toEqual(["docs/old.md"]);
		expect(report.skippedDocPaths).toEqual(["docs/b.md"]);
		expect(JSON.stringify(report)).not.toContain("redaction-canary-token");
	});

	test("preserves failed build report fields and diagnostic cause chain", () => {
		const cause = new Error("compiler exploded for docs/a.md", {
			cause: new Error("frontmatter token=redaction-canary-token invalid"),
		});
		cause.name = "CompilerError";

		const report = createBuildReport({
			repoId: "repo-a",
			strategy: "full",
			reasonCode: "source_full_rebuild",
			partial: false,
			reason: "Failed to build repo-a.",
			affectedDocPaths: ["docs/a.md"],
			diagnostics: [
				{
					severity: "error",
					stage: "compile",
					path: "docs/a.md",
					message: "Failed to rebuild doc docs/a.md for repo-a.",
					code: "IndexerBuildError",
					cause: serializeIndexerDiagnosticCause(cause, { includeStack: true }),
				},
			],
			timings: {
				startedAt: "2026-01-01T00:00:00.000Z",
				completedAt: "2026-01-01T00:00:00.000Z",
				durationMs: 0,
			},
			failed: true,
		});

		expect(report).toMatchObject({
			repoId: "repo-a",
			strategy: "full",
			reasonCode: "source_full_rebuild",
			docsConsidered: 0,
			docsRebuilt: 0,
			docsDeleted: 0,
			chunksPersisted: 0,
			skillsUpdated: 0,
			summariesUpdated: 0,
			manifestUpdated: false,
			affectedDocPaths: ["docs/a.md"],
			recovery: { previousCorpusPreserved: true, stale: true },
		});
		expect(report.diagnostics[0]?.cause).toMatchObject({
			name: "CompilerError",
			message: "compiler exploded for docs/a.md",
			cause: {
				name: "Error",
				message: "frontmatter token=[REDACTED] invalid",
			},
		});
		expect(report.diagnostics[0]?.cause?.stack).toContain("CompilerError");
		expect(JSON.stringify(report)).not.toContain("redaction-canary-token");
	});
});
