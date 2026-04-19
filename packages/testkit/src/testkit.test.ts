import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createFakeRepo,
	createLargeCorpusFiles,
	runAtlasEval,
	runMcpAdoptionEval,
	sampleMcpAdoptionDataset,
} from ".";

describe("testkit", () => {
	test("creates fake Git repositories", async () => {
		const rootPath = await mkdtemp(join(tmpdir(), "atlas-testkit-repo-"));
		try {
			const repo = await createFakeRepo({ rootPath, commit: true });
			expect(repo.revision).toMatch(/^[a-f0-9]{40}$/);
			expect(repo.files.map((file) => file.path)).toContain(
				"packages/auth/docs/session.md",
			);
		} finally {
			await rm(rootPath, { recursive: true, force: true });
		}
	});

	test("creates deterministic large corpus files", () => {
		const files = createLargeCorpusFiles({
			packageCount: 3,
			docsPerPackage: 2,
			sectionsPerDoc: 4,
			archiveDocs: 1,
		});

		expect(files).toHaveLength(10);
		expect(files.map((file) => file.path)).toContain(
			"packages/pkg-00/docs/topic-00.md",
		);
		expect(files.every((file) => !file.path.startsWith("/"))).toBe(true);
		expect(files.at(-1)?.path).toBe("docs/archive/legacy-00.md");
		expect(files[1]?.content).toContain("token budget");
	});

	test("runs deterministic eval metrics", () => {
		const report = runAtlasEval({
			dataset: {
				name: "unit",
				cases: [
					{
						id: "case-1",
						query: "session rotation",
						budgetTokens: 100,
						expected: {
							docIds: ["doc_1"],
							sectionIds: ["section_1"],
							scopeIds: ["scope_1"],
							authorities: ["preferred"],
						},
					},
				],
			},
			defaultBudgetTokens: 200,
			now: (() => {
				let value = 0;
				return () => (value += 5);
			})(),
			planContext() {
				return {
					confidence: "high",
					usedTokens: 25,
					scopes: [{ id: "scope_1" }],
					selected: [
						{
							targetType: "section",
							targetId: "section_1",
							tokenCount: 25,
							provenance: {
								repoId: "repo",
								docId: "doc_1",
								path: "docs/session.md",
								sourceVersion: "rev_1",
								authority: "preferred",
								headingPath: ["Session", "Rotation"],
							},
						},
					],
				};
			},
		});

		expect(report).toMatchObject({
			dataset: "unit",
			totalCases: 1,
			passedCases: 1,
			failedCases: 0,
			metrics: {
				docRecall: 1,
				sectionRecall: 1,
				scopeRecall: 1,
				provenanceHitRate: 1,
				authorityHitRate: 1,
				tokenBudgetPassRate: 1,
				averageLatencyMs: 5,
			},
		});
	});

	test("runs deterministic MCP adoption eval pass behavior", () => {
		const report = runMcpAdoptionEval({
			dataset: sampleMcpAdoptionDataset,
			traceCase(testCase) {
				switch (testCase.id) {
					case "indexed-repo-plan-context":
						return [
							{ kind: "read_resource", uri: "atlas://manifest" },
							{ kind: "call_tool", name: "plan_context" },
						];
					case "ambiguous-repo-check-manifest":
					case "non-indexed-repo-no-plan-context":
						return [{ kind: "read_resource", uri: "atlas://manifest" }];
					default:
						return [];
				}
			},
		});

		expect(report.passedCases).toBe(report.totalCases);
		expect(report.adoptionScore).toBe(1);
	});

	test("runs deterministic MCP adoption eval fail behavior", () => {
		const report = runMcpAdoptionEval({
			dataset: sampleMcpAdoptionDataset,
			traceCase(testCase) {
				if (testCase.id === "generic-question-no-atlas") {
					return [{ kind: "call_tool", name: "plan_context" }];
				}
				return [];
			},
		});

		const indexed = report.cases.find(
			(testCase) => testCase.id === "indexed-repo-plan-context",
		);
		expect(indexed?.missingCalls).toEqual([
			{ kind: "read_resource", uri: "atlas://manifest" },
			{ kind: "call_tool", name: "plan_context" },
		]);

		const generic = report.cases.find(
			(testCase) => testCase.id === "generic-question-no-atlas",
		);
		expect(generic?.unexpectedCalls).toEqual([
			{ kind: "call_tool", name: "plan_context" },
		]);
		expect(report.failedCases).toBeGreaterThan(0);
	});
});
