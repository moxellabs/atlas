import micromatch from "micromatch";

import type { SourceGitDiagnosticSink } from "../diagnostics";
import type { SourceChange } from "@atlas/core";

/** Include/exclude path filters used to reduce changed paths to relevant work. */
export interface RelevantPathFilters {
  /** Glob patterns to include. Empty or absent means include all paths. */
  include?: readonly string[] | undefined;
  /** Glob patterns to exclude after includes are evaluated. */
  exclude?: readonly string[] | undefined;
  /** Optional sink for structured filtering diagnostics. */
  onDiagnostic?: SourceGitDiagnosticSink | undefined;
}

/**
 * Filters changed paths using path-oriented include and exclude globs. For
 * renames, both the old and new paths are considered relevant candidates.
 */
export function filterRelevantPaths(paths: readonly SourceChange[], filters: RelevantPathFilters = {}): SourceChange[] {
  const include = normalizePatterns(filters.include);
  const exclude = normalizePatterns(filters.exclude);

  const filteredPaths = paths.filter((changedPath) => {
    const candidates = changedPath.oldPath ? [changedPath.path, changedPath.oldPath] : [changedPath.path];
    const included = include.length === 0 || candidates.some((path) => micromatch.isMatch(path, include, matchOptions));
    const excluded = exclude.length > 0 && candidates.some((path) => micromatch.isMatch(path, exclude, matchOptions));
    return included && !excluded;
  });

  filters.onDiagnostic?.({
    type: "relevant_paths_filtered",
    details: {
      inputPathCount: paths.length,
      outputPathCount: filteredPaths.length,
      includePatternCount: include.length,
      excludePatternCount: exclude.length
    }
  });

  return filteredPaths;
}

const matchOptions = {
  dot: true,
  nocase: false
} as const;

function normalizePatterns(patterns: readonly string[] | undefined): string[] {
  if (!patterns) {
    return [];
  }
  return patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
}
