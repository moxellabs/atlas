import { describe, expect, test } from "bun:test";

import { matchesAnyRepoPath, matchesRepoPath } from "./repo-path-match";

describe("repository path matching", () => {
  test("normalizes repository paths and uses micromatch glob semantics", () => {
    expect(matchesRepoPath("./docs\\guides//setup.md", "docs/**")).toBe(true);
    expect(
      matchesRepoPath("docs/reference/api.md", "docs/{guides,reference}/**"),
    ).toBe(true);
    expect(matchesRepoPath(".planning/PLAN.md", ".planning/**")).toBe(true);
    expect(matchesRepoPath("docs/README.md", "**/README.md")).toBe(true);
  });

  test("keeps matching case-sensitive and supports empty pattern lists", () => {
    expect(matchesRepoPath("README.md", "readme.md")).toBe(false);
    expect(matchesAnyRepoPath("docs/guide.md", [])).toBe(false);
  });
});
