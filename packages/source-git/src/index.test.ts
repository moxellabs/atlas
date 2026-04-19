import { describe, expect, test } from "bun:test";

import * as sourceGit from "./index";

describe("@atlas/source-git public API", () => {
  test("keeps low-level Git helpers out of the package barrel", () => {
    expect("LocalGitSourceAdapter" in sourceGit).toBe(true);
    expect("RepoCacheService" in sourceGit).toBe(true);
    expect("diffPaths" in sourceGit).toBe(true);
    expect("filterRelevantPaths" in sourceGit).toBe(true);
    expect("spawnGit" in sourceGit).toBe(false);
    expect("parseNameStatusOutput" in sourceGit).toBe(false);
    expect("buildDiffCommand" in sourceGit).toBe(false);
    expect("listMaterializedFiles" in sourceGit).toBe(false);
  });
});
