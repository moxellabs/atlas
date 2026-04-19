import type { SourceChange } from "@atlas/core";
import type { SourceGitDiagnosticSink } from "../diagnostics";
import { GitDiffError } from "../git/git-errors";
import { parseNameStatusOutput } from "../git/parse-git-output";
import type { GitNameStatusEntry } from "../git/parse-git-output";
import { spawnGit } from "../git/spawn-git";

/** Changed path shape exposed by source-git public helpers. */
export type ChangedPath = SourceChange;

/** Options for computing changed paths between two revisions. */
export interface DiffPathsOptions {
  /** ATLAS repo identifier used only for diagnostics. */
  repoId: string;
  /** Persistent local checkout path. */
  localPath: string;
  /** Base revision. */
  fromRevision: string;
  /** Target revision. */
  toRevision: string;
  /** Optional timeout applied to Git diff. */
  timeoutMs?: number | undefined;
  /** Optional sink for structured diff diagnostics. */
  onDiagnostic?: SourceGitDiagnosticSink | undefined;
}

/**
 * Computes changed paths with `git diff --name-status -z --find-renames`.
 */
export async function diffPaths(options: DiffPathsOptions): Promise<SourceChange[]> {
  const args = buildDiffCommand(options.fromRevision, options.toRevision);
  const result = await spawnGit({
    cwd: options.localPath,
    args,
    timeoutMs: options.timeoutMs
  });

  if (result.exitCode !== 0) {
    throw new GitDiffError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: result.command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout
    });
  }

  try {
    const paths = parseNameStatusOutput(result.stdout).map(toSourceChange);
    options.onDiagnostic?.({
      type: "diff_computed",
      repoId: options.repoId,
      localPath: options.localPath,
      details: {
        fromRevision: options.fromRevision,
        toRevision: options.toRevision,
        changedPathCount: paths.length
      }
    });
    return paths;
  } catch (cause) {
    throw new GitDiffError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: result.command,
      stderr: result.stderr,
      stdout: result.stdout,
      cause
    });
  }
}

/**
 * Builds the Git diff command used for changed-path detection.
 */
export function buildDiffCommand(fromRevision: string, toRevision: string): string[] {
  return ["diff", "--name-status", "-z", "--find-renames", "--find-copies-harder", `${fromRevision}..${toRevision}`];
}

function toSourceChange(entry: GitNameStatusEntry): SourceChange {
  const statusMap = {
    A: { rawKind: "added", normalizedKind: "added" },
    M: { rawKind: "modified", normalizedKind: "modified" },
    D: { rawKind: "deleted", normalizedKind: "deleted" },
    R: { rawKind: "renamed", normalizedKind: "renamed" },
    C: { rawKind: "copied", normalizedKind: "modified" },
    T: { rawKind: "type-changed", normalizedKind: "modified" }
  } as const;

  const change: SourceChange = {
    path: entry.path,
    ...statusMap[entry.status]
  };
  if (entry.oldPath) {
    change.oldPath = entry.oldPath;
  }
  return change;
}
