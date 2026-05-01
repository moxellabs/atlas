import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  buildReport,
  caseMetadata,
  evaluateExpectations,
  loadEvalDataset,
  type CaseResult,
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
    expect(report.metrics.averageRankedHits).toBe(3);
    expect(report.byCategory.a).toEqual({
      total: 2,
      passed: 1,
      pathRecall: 0.75,
      termRecall: 0.5,
      averageLatencyMs: 20,
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
        expected: {},
      }),
    ).toEqual({
      profile: "maintainer",
      feature: "retrieval",
      scenario: "smoke",
      priority: "p0",
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
