import { describe, expect, test } from "bun:test";
import type { TopologyRule } from "@atlas/core";

import { evaluateTopologyRules, isMatch, TopologyRuleError } from "./evaluate-topology-rules";

const rules: TopologyRule[] = [
  {
    id: "low",
    kind: "guide-doc",
    match: { include: ["docs/**/*.md"] },
    ownership: { attachTo: "repo" },
    authority: "supplemental",
    priority: 1
  },
  {
    id: "high",
    kind: "repo-doc",
    match: { include: ["docs/**/*.md"], exclude: ["docs/private/**"] },
    ownership: { attachTo: "repo" },
    authority: "canonical",
    priority: 10
  }
];

describe("evaluateTopologyRules", () => {
  test("matches include patterns, applies excludes, and sorts by priority", () => {
    expect(evaluateTopologyRules({ path: "./docs\\guide.md", rules }).map((match) => match.ruleId)).toEqual([
      "high",
      "low"
    ]);
    expect(evaluateTopologyRules({ path: "docs/private/notes.md", rules }).map((match) => match.ruleId)).toEqual([
      "low"
    ]);
  });

  test("uses rule id as deterministic tie-breaker", () => {
    const tiedRules = [
      { ...rules[0]!, id: "b", priority: 5 },
      { ...rules[0]!, id: "a", priority: 5 }
    ];

    expect(evaluateTopologyRules({ path: "docs/guide.md", rules: tiedRules }).map((match) => match.ruleId)).toEqual([
      "a",
      "b"
    ]);
  });

  test("normalizes paths before matching", () => {
    expect(isMatch(".\\docs//guide.md", "docs/**/*.md")).toBe(true);
  });

  test("rejects invalid runtime rule shapes", () => {
    expect(() =>
      evaluateTopologyRules({
        path: "docs/guide.md",
        rules: [{ ...rules[0]!, id: "", match: { include: [] } }]
      })
    ).toThrow(TopologyRuleError);
  });
});
