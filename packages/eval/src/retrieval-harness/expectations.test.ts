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
