import { describe, expect, test } from "bun:test";

import { buildReport } from "../report";
import { partialRetrieval, result } from "./test-fixtures";

describe("retrieval report aggregation", () => {
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
    expect(report.metrics.averageRankDistance).toBe(0);
    expect(report.metrics.averageTopPathDiversity).toBe(1);
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
          retrieval: partialRetrieval({
            expectedPathRanks: [4],
            bestExpectedPathRank: 4,
            recallAt1: 0,
            recallAt3: 0,
            recallAt5: 1,
            reciprocalRank: 0.25,
            precisionAt1: 0,
            precisionAt3: 0,
            precisionAt5: 0.2,
            ndcgAt3: 0,
            ndcgAt5: 0.4307,
            rankDistance: 3,
            topPathDiversity: 2,
          }),
        }),
        result({
          id: "missing",
          category: "rank",
          latencyMs: 1100,
          retrieval: partialRetrieval({
            expectedPathRanks: [],
            recallAt1: 0,
            recallAt3: 0,
            recallAt5: 0,
            reciprocalRank: 0,
          }),
          missing: {
            pathIncludes: ["docs/missing.md"],
            pathExcludes: [],
            pathPrecedes: [],
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
          retrieval: partialRetrieval({
            expectedPathRanks: [],
            recallAt1: 1,
            recallAt3: 1,
            recallAt5: 1,
            reciprocalRank: 0,
          }),
        }),
      ],
      { cli: "bun run cli", source: "cli-default" },
      {},
    );

    expect(report.metrics.expectedPathPrecisionAt1).toBe(0.25);
    expect(report.metrics.expectedPathPrecisionAt5).toBe(0.1);
    expect(report.quality.rankBuckets.map((bucket) => bucket.count)).toEqual([
      1, 0, 1, 0, 0, 2,
    ]);
    expect(report.quality.latencyBuckets.map((bucket) => bucket.count)).toEqual(
      [2, 0, 1, 1],
    );
    expect(report.narrative.caveats.join(" ")).toContain("Perfect pass rate");
    expect(report.narrative.severity).not.toBe("good");
    expect(report.narrative.keyFindings.length).toBeGreaterThan(0);
  });

  test("narrative severity reflects worst dimension even with perfect pass rate", () => {
    const report = buildReport(
      { name: "dataset", cases: [] },
      [
        result({
          id: "only-case",
          category: "rank",
          retrieval: partialRetrieval({
            expectedPathRanks: [8],
            bestExpectedPathRank: 8,
            recallAt1: 0,
            recallAt3: 0,
            recallAt5: 0,
            reciprocalRank: 0.125,
            topPathDiversity: 1,
          }),
        }),
      ],
      { cli: "bun run cli", source: "cli-default" },
      {},
    );

    expect(report.metrics.passRate).toBe(1);
    expect(report.narrative.severity).toBe("bad");
    const recallFinding = report.narrative.keyFindings.find(
      (finding) => finding.metric === "pathRecallAt5",
    );
    expect(recallFinding?.severity).toBe("bad");
    expect(report.narrative.headline).toMatch(
      /safe but poorly ranked|correctness|broken|warn/i,
    );
  });

  test("limits the weakest-case worklist to ten entries", () => {
    const report = buildReport(
      { name: "dataset", cases: [] },
      Array.from({ length: 12 }, (_, index) =>
        result({
          id: `case-${String(index).padStart(2, "0")}`,
          category: "limit",
        }),
      ),
      { cli: "bun run cli", source: "cli-default" },
      {},
    );

    expect(report.quality.weakestCases.map(({ id }) => id)).toEqual(
      Array.from(
        { length: 10 },
        (_, index) => `case-${String(index).padStart(2, "0")}`,
      ),
    );
  });
  test("keeps report serialization deterministic apart from generation time", () => {
    const input = [
      result({
        id: "stable",
        category: "determinism",
        feature: "reporting",
        retrieval: partialRetrieval({
          expectedPathRanks: [2],
          bestExpectedPathRank: 2,
          recallAt1: 0,
          recallAt3: 1,
          recallAt5: 1,
          reciprocalRank: 0.5,
        }),
      }),
    ];
    const runtime = { cli: "bun run cli", source: "cli-default" } as const;
    const first = buildReport(
      { name: "dataset", cases: [] },
      input,
      runtime,
      {},
    );
    const second = buildReport(
      { name: "dataset", cases: [] },
      input,
      runtime,
      {},
    );

    const firstSerialized = JSON.stringify(first).replace(
      /"generatedAt":"[^"]+"/,
      '"generatedAt":"<generated-at>"',
    );
    const secondSerialized = JSON.stringify(second).replace(
      /"generatedAt":"[^"]+"/,
      '"generatedAt":"<generated-at>"',
    );
    expect(firstSerialized).toBe(secondSerialized);
  });
});
