import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";

/** Resolves a CLI-supplied path relative to the effective working directory. */
export function resolveCliPath(path: string, cwd: string): string {
  const expanded = path === "~" || path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path;
  return resolve(cwd, expanded);
}

/** Returns a human-readable relative path when possible. */
export function displayPath(path: string, cwd: string): string {
  const relativePath = relative(cwd, path);
  return relativePath.length === 0 || relativePath.startsWith("..") ? path : relativePath;
}

/** Returns the parent directory for a file path. */
export function parentDir(path: string): string {
  return dirname(path);
}
