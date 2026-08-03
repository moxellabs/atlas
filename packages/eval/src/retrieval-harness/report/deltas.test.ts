import { describe, expect, test } from "bun:test";

import type { BaselineSummary } from "../types";
import { buildReport } from "../report";
import { partialRetrieval, result } from "./test-fixtures";

describe("retrieval report deltas", () => {
  test("computes baseline deltas and flags regressions", () => {
    const baseline: BaselineSummary = {
      dataset: "dataset",
      generatedAt: "2026-01-01T00:00:00Z",
      repoRevision: "prev",
      metrics: {
        passRate: 1,
        pathRecallAt5: 0.8,
        mrr: 0.6,
        p95LatencyMs: 500,
      },
    };
    const report = buildReport(
      { name: "dataset", cases: [] },
      [
        result({
          id: "case",
          category: "rank",
          retrieval: partialRetrieval({
            expectedPathRanks: [5],
            bestExpectedPathRank: 5,
            recallAt5: 0.5,
            reciprocalRank: 0.2,
          }),
          latencyMs: 800,
        }),
      ],
      { cli: "bun run cli", source: "cli-default" },
      {},
      { maxMetricRegression: 0.1 },
      baseline,
    );
    expect(report.deltas).toBeDefined();
    const recallDelta = report.deltas?.entries.find(
      (entry) => entry.metric === "pathRecallAt5",
    );
    expect(recallDelta?.delta).toBeCloseTo(-0.3, 2);
    expect(recallDelta?.severity).toBe("bad");
    expect(
      report.deltas?.regressions.find((r) => r.metric === "pathRecallAt5"),
    ).toBeDefined();
    expect(report.thresholds?.passed).toBe(false);
  });
});
