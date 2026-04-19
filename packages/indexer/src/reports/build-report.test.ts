import { describe, expect, test } from "bun:test";

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
});
