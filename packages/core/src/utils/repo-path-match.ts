import micromatch from "micromatch";

/** Normalizes and matches a repository-local path with the shared glob policy. */
export function matchesRepoPath(path: string, pattern: string): boolean {
  return micromatch.isMatch(
    normalizeRepoPath(path),
    normalizeRepoPath(pattern),
    {
      dot: true,
      nocase: false,
    },
  );
}

/** Returns whether a repository-local path matches any supplied pattern. */
export function matchesAnyRepoPath(
  path: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => matchesRepoPath(path, pattern));
}

function normalizeRepoPath(path: string): string {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/$/, "");
}
