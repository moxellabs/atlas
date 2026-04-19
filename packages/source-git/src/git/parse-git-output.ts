/** Raw Git name-status values supported by the source-git diff parser. */
export type GitNameStatus = "A" | "M" | "D" | "R" | "C" | "T";

/** Structured changed path parsed from `git diff --name-status -z`. */
export interface GitNameStatusEntry {
  /** Git's compact status code. */
  status: GitNameStatus;
  /** Current path for added, modified, copied, typed, and renamed entries. */
  path: string;
  /** Previous path for rename and copy entries. */
  oldPath?: string;
}

/**
 * Parses rev-parse output into a single commit SHA string.
 */
export function parseRevisionOutput(stdout: string): string {
  return stdout.trim();
}

/**
 * Parses NUL-delimited `git diff --name-status -z` output, including rename
 * and copy records that contain old and new paths.
 */
export function parseNameStatusOutput(stdout: string): GitNameStatusEntry[] {
  if (stdout.length === 0) {
    return [];
  }

  const fields = stdout.split("\0").filter((field) => field.length > 0);
  const entries: GitNameStatusEntry[] = [];

  for (let index = 0; index < fields.length; ) {
    const rawStatus = fields[index];
    if (!rawStatus) {
      break;
    }

    const status = normalizeNameStatus(rawStatus);
    index += 1;

    if (status === "R" || status === "C") {
      const oldPath = fields[index];
      const path = fields[index + 1];
      if (!oldPath || !path) {
        throw new Error(`Malformed Git name-status output for ${rawStatus}.`);
      }
      entries.push({ status, oldPath, path });
      index += 2;
      continue;
    }

    const path = fields[index];
    if (!path) {
      throw new Error(`Malformed Git name-status output for ${rawStatus}.`);
    }
    entries.push({ status, path });
    index += 1;
  }

  return entries;
}

/**
 * Parses `git ls-files -z` output into normalized repository-relative paths.
 */
export function parseNullDelimitedPaths(stdout: string): string[] {
  if (stdout.length === 0) {
    return [];
  }
  return stdout.split("\0").filter((path) => path.length > 0);
}

function normalizeNameStatus(rawStatus: string): GitNameStatus {
  const status = rawStatus[0];
  if (status === "A" || status === "M" || status === "D" || status === "R" || status === "C" || status === "T") {
    return status;
  }
  throw new Error(`Unsupported Git name-status value: ${rawStatus}`);
}
