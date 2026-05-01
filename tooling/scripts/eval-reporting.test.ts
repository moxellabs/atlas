import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  buildReport,
  caseMetadata,
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
    missing: input.missing ?? { pathIncludes: [], terms: [] },
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
