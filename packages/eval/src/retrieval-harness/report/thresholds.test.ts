import { describe, expect, test } from "bun:test";

import { buildReport } from "../report";
import { partialRetrieval, result } from "./test-fixtures";

describe("retrieval report thresholds", () => {
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
      { minPassRate: 0.75, minPathRecall: 1, maxP95LatencyMs: 5 },
    );

    expect(report.thresholds?.passed).toBe(false);
    const labels = report.thresholds?.results.map((entry) => entry.label);
    expect(labels).toContain("Pass rate");
    expect(labels).toContain("Path recall");
    expect(labels).toContain("p95 latency");
    const latency = report.thresholds?.results.find(
      (entry) => entry.label === "p95 latency",
    );
    expect(latency?.direction).toBe("lower");
    expect(latency?.passed).toBe(false);
    const passGate = report.thresholds?.results.find(
      (entry) => entry.label === "Pass rate",
    );
    expect(passGate?.direction).toBe("higher");
    expect(passGate?.limit).toBe(0.75);
  });

  test("enforces ranking thresholds via minRecallAt5 and minMrr", () => {
    const report = buildReport(
      { name: "dataset", cases: [] },
      [
        result({
          id: "weak-rank",
          category: "rank",
          retrieval: partialRetrieval({
            expectedPathRanks: [9],
            bestExpectedPathRank: 9,
            recallAt5: 0,
            reciprocalRank: 0.1111,
          }),
        }),
      ],
      { cli: "bun run cli", source: "cli-default" },
      {},
      { minRecallAt5: 0.5, minMrr: 0.3 },
    );
    expect(report.thresholds?.passed).toBe(false);
    const recallGate = report.thresholds?.results.find(
      (entry) => entry.label === "Recall@5",
    );
    expect(recallGate?.passed).toBe(false);
  });
});
