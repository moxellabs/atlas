import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildReport,
	type CaseResult,
	caseMetadata,
	evaluateExpectations,
	loadEvalDataset,
	renderHtml,
} from "./eval-reporting";

function result(
	input: Partial<CaseResult> & Pick<CaseResult, "id" | "category">,
): CaseResult {
	return {
		id: input.id,
		category: input.category,
		query: input.query ?? "query",
		passed: input.passed ?? true,
		latencyMs: input.latencyMs ?? 10,
		selectedCount: input.selectedCount ?? 1,
		rankedCount: input.rankedCount ?? 2,
		scores: input.scores ?? {
			pathRecall: 1,
			termRecall: 1,
			nonEmptyContext: true,
		},
		retrieval: input.retrieval ?? {
			expectedPathRanks: [1],
			bestExpectedPathRank: 1,
			recallAt1: 1,
			recallAt3: 1,
			recallAt5: 1,
			reciprocalRank: 1,
			noResultCorrect: true,
			forbiddenPathCorrect: true,
		},
		missing: input.missing ?? {
			pathIncludes: [],
			pathExcludes: [],
			terms: [],
			diagnosticsInclude: [],
			rankedHits: [],
			confidence: [],
			noResults: [],
		},
		topPaths: input.topPaths ?? [],
		diagnostics: input.diagnostics ?? [],
		...(input.profile === undefined ? {} : { profile: input.profile }),
		...(input.feature === undefined ? {} : { feature: input.feature }),
		...(input.scenario === undefined ? {} : { scenario: input.scenario }),
		...(input.priority === undefined ? {} : { priority: input.priority }),
		...(input.capability === undefined ? {} : { capability: input.capability }),
		...(input.claim === undefined ? {} : { claim: input.claim }),
		...(input.whyItMatters === undefined
			? {}
			: { whyItMatters: input.whyItMatters }),
		...(input.expectedBehavior === undefined
			? {}
			: { expectedBehavior: input.expectedBehavior }),
		...(input.coverageType === undefined
			? {}
			: { coverageType: input.coverageType }),
		...(input.riskArea === undefined ? {} : { riskArea: input.riskArea }),
	};
}

describe("eval reporting", () => {
	test("aggregates report metrics and category breakdowns", () => {
		const report = buildReport(
			{ name: "dataset", cases: [] },
			[
				result({ id: "one", category: "a", latencyMs: 10, rankedCount: 4 }),
				result({
					id: "two",
					category: "a",
					passed: false,
					latencyMs: 30,
					rankedCount: 2,
					scores: {
						pathRecall: 0.5,
						termRecall: 0,
						nonEmptyContext: false,
					},
				}),
			],
			{ cli: "bun run cli", source: "cli-default" },
			{},
		);

		expect(report.totalCases).toBe(2);
		expect(report.passedCases).toBe(1);
		expect(report.failedCases).toBe(1);
		expect(report.metrics.passRate).toBe(0.5);
		expect(report.metrics.pathRecall).toBe(0.75);
		expect(report.metrics.termRecall).toBe(0.5);
		expect(report.metrics.nonEmptyContextRate).toBe(0.5);
		expect(report.metrics.averageLatencyMs).toBe(20);
		expect(report.metrics.medianLatencyMs).toBe(10);
		expect(report.metrics.p95LatencyMs).toBe(30);
		expect(report.metrics.averageRankedHits).toBe(3);
		expect(report.metrics.pathRecallAt1).toBe(1);
		expect(report.metrics.pathRecallAt3).toBe(1);
		expect(report.metrics.pathRecallAt5).toBe(1);
		expect(report.metrics.mrr).toBe(1);
		expect(report.metrics.noResultAccuracy).toBe(1);
		expect(report.metrics.forbiddenPathAccuracy).toBe(1);
		expect(report.coverage.capabilities).toEqual({ a: 2 });
		expect(report.byCategory.a).toEqual({
			total: 2,
			passed: 1,
			passRate: 0.5,
			pathRecall: 0.75,
			termRecall: 0.5,
			nonEmptyContextRate: 0.5,
			averageLatencyMs: 20,
			recallAt5: 1,
			mrr: 1,
		});
	});

	test("aggregates profile feature and scenario groups with unknown fallback", () => {
		const report = buildReport(
			{ name: "dataset", cases: [] },
			[
				result({
					id: "one",
					category: "a",
					profile: "maintainer",
					feature: "install",
					scenario: "happy-path",
				}),
				result({
					id: "two",
					category: "b",
					passed: false,
					feature: "install",
					scores: {
						pathRecall: 0,
						termRecall: 0.5,
						nonEmptyContext: false,
					},
				}),
			],
			{ cli: "bun run cli", source: "cli-default" },
			{},
		);

		expect(report.byProfile.maintainer?.passed).toBe(1);
		expect(report.byProfile.unknown).toMatchObject({
			total: 1,
			passed: 0,
			passRate: 0,
		});
		expect(report.byFeature.install).toMatchObject({
			total: 2,
			passed: 1,
			pathRecall: 0.5,
			termRecall: 0.75,
			nonEmptyContextRate: 0.5,
		});
		expect(report.byScenario["happy-path"]?.total).toBe(1);
		expect(report.byScenario.unknown?.total).toBe(1);
	});

	test("derives sparse-label rank quality and narrative metrics", () => {
		const report = buildReport(
			{ name: "dataset", cases: [] },
			[
				result({ id: "rank-one", category: "rank", topPaths: ["docs/a.md"] }),
				result({
					id: "rank-four",
					category: "rank",
					latencyMs: 600,
					retrieval: {
						expectedPathRanks: [4],
						bestExpectedPathRank: 4,
						recallAt1: 0,
						recallAt3: 0,
						recallAt5: 1,
						reciprocalRank: 0.25,
						noResultCorrect: true,
						forbiddenPathCorrect: true,
					},
				}),
				result({
					id: "missing",
					category: "rank",
					latencyMs: 1100,
					retrieval: {
						expectedPathRanks: [],
						recallAt1: 0,
						recallAt3: 0,
						recallAt5: 0,
						reciprocalRank: 0,
						noResultCorrect: true,
						forbiddenPathCorrect: true,
					},
					missing: {
						pathIncludes: ["docs/missing.md"],
						pathExcludes: [],
						terms: [],
						diagnosticsInclude: [],
						rankedHits: [],
						confidence: [],
						noResults: [],
					},
				}),
				result({
					id: "no-result",
					category: "edge",
					selectedCount: 0,
					rankedCount: 0,
					scores: { pathRecall: 1, termRecall: 1, nonEmptyContext: false },
					retrieval: {
						expectedPathRanks: [],
						recallAt1: 1,
						recallAt3: 1,
						recallAt5: 1,
						reciprocalRank: 0,
						noResultCorrect: true,
						forbiddenPathCorrect: true,
					},
				}),
			],
			{ cli: "bun run cli", source: "cli-default" },
			{},
		);

		expect(report.metrics.expectedPathPrecisionAt1).toBe(0.25);
		expect(report.metrics.expectedPathPrecisionAt3).toBe(0.0833);
		expect(report.metrics.expectedPathPrecisionAt5).toBe(0.1);
		expect(report.metrics.expectedPathNdcgAt3).toBe(0.25);
		expect(report.metrics.expectedPathNdcgAt5).toBe(0.3577);
		expect(report.quality.rankBuckets.map((bucket) => bucket.count)).toEqual([
			1, 0, 1, 0, 0, 2,
		]);
		expect(report.quality.latencyBuckets.map((bucket) => bucket.count)).toEqual(
			[2, 0, 1, 1],
		);
		expect(report.narrative.caveats.join(" ")).toContain("Perfect pass rate");
	});

	test("renders Moxel report markers, explorer controls, and safe embedded JSON", () => {
		const report = buildReport(
			{ name: "dataset <script>", cases: [] },
			[
				result({
					id: "case-danger",
					category: "security",
					query: "<script>alert(1)</script>",
					claim: "Claim <img src=x>",
					riskArea: "privacy",
					topPaths: ["docs/<unsafe>.md"],
				}),
			],
			{ cli: "bun run cli", source: "cli-default" },
			{},
		);

		const html = renderHtml(report);

		expect(html).toContain("moxel-atlas-eval-report-theme");
		expect(html).toContain("MOXEL ATLAS EVALS");
		expect(html).toContain('id="banded-field"');
		expect(html).toContain('data-eval-chart="recall-funnel"');
		expect(html).toContain('data-eval-chart="metric-radar"');
		expect(html).toContain('id="case-explorer"');
		expect(html).toContain('id="case-search"');
		expect(html).toContain(
			'id="atlas-eval-report-data" type="application/json"',
		);
		expect(html).toContain("Methodology factsheet");
		expect(html).toContain("Reproducibility");
		expect(html).toContain("Collapsed by default");
		expect(html).toContain("Atlas finds the required docs");
		expect(html).not.toContain("Grounded project evidence for agent workflows");
		expect(html).toContain("\\u003cscript");
		expect(html).not.toContain("<script>alert(1)</script>");
	});

	test("includes optional threshold results without applying gates by default", () => {
		const base = buildReport(
			{ name: "dataset", cases: [] },
			[result({ id: "one", category: "a" })],
			{ cli: "bun run cli", source: "cli-default" },
			{},
		);
		expect(base.thresholds).toBeUndefined();

		const report = buildReport(
			{ name: "dataset", cases: [] },
			[
				result({ id: "one", category: "a" }),
				result({ id: "two", category: "a", passed: false }),
			],
			{ cli: "bun run cli", source: "cli-default" },
			{},
			{ minPassRate: 0.75, minPathRecall: 1 },
		);

		expect(report.thresholds).toEqual({
			passed: false,
			results: [
				{
					metric: "passRate",
					label: "Pass rate",
					actual: 0.5,
					minimum: 0.75,
					passed: false,
				},
				{
					metric: "pathRecall",
					label: "Path recall",
					actual: 1,
					minimum: 1,
					passed: true,
				},
			],
		});
	});

	test("preserves optional case metadata", () => {
		expect(
			caseMetadata({
				id: "case",
				category: "category",
				query: "query",
				profile: "maintainer",
				feature: "retrieval",
				scenario: "smoke",
				priority: "p0",
				capability: "Retrieval quality",
				claim: "Atlas retrieves expected docs.",
				whyItMatters: "Developers need grounded evidence.",
				expectedBehavior: "Retrieve docs.",
				coverageType: "source-recall",
				riskArea: "workflow-retrieval",
				expected: {},
			}),
		).toEqual({
			profile: "maintainer",
			feature: "retrieval",
			scenario: "smoke",
			priority: "p0",
			capability: "Retrieval quality",
			claim: "Atlas retrieves expected docs.",
			whyItMatters: "Developers need grounded evidence.",
			expectedBehavior: "Retrieve docs.",
			coverageType: "source-recall",
			riskArea: "workflow-retrieval",
		});
	});

	test("scores negative and deterministic expectation fields", () => {
		const scored = evaluateExpectations({
			testCase: {
				id: "negative",
				category: "edge",
				query: "query",
				expected: {
					pathIncludes: ["docs/security.md"],
					pathExcludes: ["docs/archive/"],
					terms: ["local corpus"],
					minRankedHits: 1,
					maxRankedHits: 3,
					confidence: "low",
					diagnosticsInclude: ["planning"],
				},
			},
			topPaths: ["docs/security.md"],
			textHaystack: "retrieval reads the local corpus",
			diagnosticsHaystack: JSON.stringify([{ stage: "planning" }]),
			selectedCount: 1,
			rankedCount: 2,
			confidence: "low",
		});

		expect(scored.passed).toBe(true);
		expect(scored.scores).toEqual({
			pathRecall: 1,
			termRecall: 1,
			nonEmptyContext: true,
		});
		expect(scored.missing).toEqual({
			pathIncludes: [],
			pathExcludes: [],
			terms: [],
			diagnosticsInclude: [],
			rankedHits: [],
			confidence: [],
			noResults: [],
		});
	});

	test("allows no-result cases without requiring non-empty context", () => {
		const scored = evaluateExpectations({
			testCase: {
				id: "no-results",
				category: "edge",
				query: "query",
				expected: { noResults: true, maxRankedHits: 0 },
			},
			topPaths: [],
			textHaystack: "",
			diagnosticsHaystack: "",
			selectedCount: 0,
			rankedCount: 0,
		});

		expect(scored.passed).toBe(true);
		expect(scored.scores.nonEmptyContext).toBe(false);
	});

	test("reports expectation gaps for excluded paths and rank bounds", () => {
		const scored = evaluateExpectations({
			testCase: {
				id: "gaps",
				category: "edge",
				query: "query",
				expected: {
					pathExcludes: ["docs/archive/"],
					maxRankedHits: 1,
					confidence: "high",
					diagnosticsInclude: ["budget"],
				},
			},
			topPaths: ["docs/archive/old.md"],
			textHaystack: "",
			diagnosticsHaystack: "ranking",
			selectedCount: 1,
			rankedCount: 2,
			confidence: "low",
		});

		expect(scored.passed).toBe(false);
		expect(scored.missing.pathExcludes).toEqual(["docs/archive/"]);
		expect(scored.missing.rankedHits).toEqual(["rankedCount <= 1"]);
		expect(scored.missing.confidence).toEqual(["confidence=high"]);
		expect(scored.missing.diagnosticsInclude).toEqual(["budget"]);
	});

	test("resolves manifest includes relative to the manifest file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "atlas-eval-test-"));
		await writeFile(
			join(dir, "child.json"),
			JSON.stringify({
				name: "child",
				repoId: "child-repo",
				cases: [
					{
						id: "included",
						category: "smoke",
						query: "query",
						expected: {},
					},
				],
			}),
		);
		await writeFile(
			join(dir, "manifest.json"),
			JSON.stringify({
				name: "manifest",
				description: "full suite",
				repoId: "manifest-repo",
				includes: ["child.json"],
				cases: [],
			}),
		);

		const dataset = await loadEvalDataset(join(dir, "manifest.json"));

		expect(dataset.name).toBe("manifest");
		expect(dataset.cases).toHaveLength(1);
		expect(dataset.cases[0]?.id).toBe("included");
		expect(dataset.cases[0]?.repoId).toBe("child-repo");
	});

	test("rejects duplicate case ids across includes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "atlas-eval-test-"));
		const child = {
			name: "child",
			cases: [
				{
					id: "duplicate",
					category: "smoke",
					query: "query",
					expected: {},
				},
			],
		};
		await writeFile(join(dir, "one.json"), JSON.stringify(child));
		await writeFile(join(dir, "two.json"), JSON.stringify(child));
		await writeFile(
			join(dir, "manifest.json"),
			JSON.stringify({
				name: "manifest",
				includes: ["one.json", "two.json"],
				cases: [],
			}),
		);

		await expect(loadEvalDataset(join(dir, "manifest.json"))).rejects.toThrow(
			"Duplicate eval case id",
		);
	});
});
