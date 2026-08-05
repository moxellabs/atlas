import { describe, expect, test } from "bun:test";

import { classifyQuery } from "./classify-query";

describe("classifyQuery", () => {
  test("classifies query intent deterministically", () => {
    expect(classifyQuery("how do I use the session skill?")).toMatchObject({
      kind: "skill-invocation",
      confidence: "high",
    });
    expect(
      classifyQuery("where is packages/auth/docs/session.md?"),
    ).toMatchObject({
      kind: "location",
    });
    expect(classifyQuery("packages/auth/docs/session.md")).toMatchObject({
      kind: "exact-lookup",
    });
    expect(
      classifyQuery(
        "when should an agent use plan_context instead of find_docs",
      ),
    ).toMatchObject({
      kind: "exact-lookup",
      signals: expect.arrayContaining(["precise-passage"]),
    });
    expect(
      classifyQuery(
        "retrieve the documented prefer-local behavior for partial coverage",
      ),
    ).toMatchObject({ kind: "exact-lookup" });
    expect(
      classifyQuery("state the exact default MCP server identity"),
    ).toMatchObject({ kind: "exact-lookup" });
    expect(
      classifyQuery(
        "How does a maintainer build and publish .moxel/atlas artifacts?",
      ),
    ).not.toMatchObject({ kind: "exact-lookup" });
    expect(classifyQuery("compare login and session flows")).toMatchObject({
      kind: "compare",
    });
    expect(classifyQuery("how does MCP context retrieval work?")).toMatchObject(
      { kind: "usage" },
    );
    expect(
      classifyQuery("how do repo artifacts build publish and sync?"),
    ).toMatchObject({ kind: "usage" });
    expect(
      classifyQuery("explain SQLite FTS corpus index search"),
    ).toMatchObject({ kind: "usage" });
  });
});
