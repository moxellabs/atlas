/**
 * Converts any repo-local path spelling into a slash-normalized relative path.
 */
export function normalizeRepoPath(path: string): string {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/$/, "");
}

/** Returns the parent directory for a normalized repo path. */
export function dirname(path: string): string {
  const normalized = normalizeRepoPath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

/** Returns the final path segment for a normalized repo path. */
export function basename(path: string): string {
  const normalized = normalizeRepoPath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/** Returns true when `path` is equal to or contained by `root`. */
export function containsPath(root: string, path: string): boolean {
  const normalizedRoot = normalizeRepoPath(root);
  const normalizedPath = normalizeRepoPath(path);
  return normalizedRoot === "" || normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

/** Sorts roots from deepest to shallowest, then lexicographically. */
export function sortDeepestFirst<T extends { path: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const depthDelta = segmentCount(right.path) - segmentCount(left.path);
    return depthDelta === 0 ? left.path.localeCompare(right.path) : depthDelta;
  });
}

/** Returns path segments for a normalized repo path. */
export function pathSegments(path: string): string[] {
  const normalized = normalizeRepoPath(path);
  return normalized.length === 0 ? [] : normalized.split("/");
}

function segmentCount(path: string): number {
  return pathSegments(path).length;
}
