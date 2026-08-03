import { describe, expect, test } from "bun:test";

import { evaluateExpectations } from "./expectations";

function evaluate(topPaths: string[]) {
  return evaluateExpectations({
    testCase: {
      id: "path-precedence",
      category: "retrieval-quality",
      query: "How does the controller work?",
      expected: {
        pathPrecedes: [
          {
            preferred: "docs/controller-architecture.md",
            over: "CHANGELOG.md",
          },
        ],
      },
    },
    topPaths,
    textHaystack: "",
    diagnosticsHaystack: "",
    selectedCount: 1,
    rankedCount: topPaths.length,
  });
}

describe("retrieval path precedence expectations", () => {
  test("passes when preferred evidence ranks first or noise is absent", () => {
    expect(
      evaluate(["docs/controller-architecture.md", "CHANGELOG.md"]),
    ).toMatchObject({ passed: true, missing: { pathPrecedes: [] } });
    expect(evaluate(["docs/controller-architecture.md"])).toMatchObject({
      passed: true,
      missing: { pathPrecedes: [] },
    });
  });

  test("fails when noise ranks first or preferred evidence is absent", () => {
    expect(
      evaluate(["CHANGELOG.md", "docs/controller-architecture.md"]),
    ).toMatchObject({
      passed: false,
      missing: {
        pathPrecedes: ["docs/controller-architecture.md before CHANGELOG.md"],
      },
    });
    expect(evaluate(["CHANGELOG.md"])).toMatchObject({
      passed: false,
      missing: {
        pathPrecedes: ["docs/controller-architecture.md before CHANGELOG.md"],
      },
    });
  });
});

describe("retrieval expectation scoring", () => {
  test("evaluateExpectations computes per-case precision, nDCG, rankDistance, and diversity", () => {
    const scored = evaluateExpectations({
      testCase: {
        id: "scored",
        category: "rank",
        query: "query",
        expected: { pathIncludes: ["docs/a.md", "docs/b.md"] },
      },
      topPaths: ["docs/a.md", "src/ignore.ts", "docs/b.md"],
      textHaystack: "",
      diagnosticsHaystack: "",
      selectedCount: 2,
      rankedCount: 3,
    });
    expect(scored.retrieval.precisionAt1).toBeCloseTo(1, 2);
    expect(scored.retrieval.precisionAt3).toBeCloseTo(0.6667, 3);
    expect(scored.retrieval.precisionAt5).toBeCloseTo(0.4, 2);
    expect(scored.retrieval.ndcgAt5).toBeGreaterThan(0);
    expect(scored.retrieval.rankDistance).toBe(0);
    expect(scored.retrieval.topPathDiversity).toBe(2);
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
      pathPrecedes: [],
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
});
