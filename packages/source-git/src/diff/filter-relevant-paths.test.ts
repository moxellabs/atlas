import { describe, expect, test } from "bun:test";

import type { SourceChange } from "@atlas/core";
import { filterRelevantPaths } from "./filter-relevant-paths";

const paths: SourceChange[] = [
  { rawKind: "modified", normalizedKind: "modified", path: "docs/guide.md" },
  { rawKind: "modified", normalizedKind: "modified", path: "src/app.ts" },
  { rawKind: "renamed", normalizedKind: "renamed", oldPath: "docs/old.md", path: "archive/old.md" },
  { rawKind: "deleted", normalizedKind: "deleted", path: "docs/private/notes.md" }
];

describe("filterRelevantPaths", () => {
  test("filters changed paths by include and exclude globs", () => {
    expect(
      filterRelevantPaths(paths, {
        include: ["docs/**/*.md"],
        exclude: ["docs/private/**"]
      })
    ).toEqual([
      { rawKind: "modified", normalizedKind: "modified", path: "docs/guide.md" },
      { rawKind: "renamed", normalizedKind: "renamed", oldPath: "docs/old.md", path: "archive/old.md" }
    ]);
  });

  test("includes all paths when include filters are absent", () => {
    expect(filterRelevantPaths(paths, { exclude: ["src/**"] })).toEqual([
      { rawKind: "modified", normalizedKind: "modified", path: "docs/guide.md" },
      { rawKind: "renamed", normalizedKind: "renamed", oldPath: "docs/old.md", path: "archive/old.md" },
      { rawKind: "deleted", normalizedKind: "deleted", path: "docs/private/notes.md" }
    ]);
  });

  test("emits relevant path count diagnostics", () => {
    const diagnostics: unknown[] = [];

    filterRelevantPaths(paths, {
      include: ["docs/**/*.md"],
      onDiagnostic: (event) => diagnostics.push(event)
    });

    expect(diagnostics).toEqual([
      {
        type: "relevant_paths_filtered",
        details: {
          inputPathCount: 4,
          outputPathCount: 3,
          includePatternCount: 1,
          excludePatternCount: 0
        }
      }
    ]);
  });
});
