import { GitFetchError, GitRefResolutionError } from "../git/git-errors";
import { parseRevisionOutput } from "../git/parse-git-output";
import { spawnGit } from "../git/spawn-git";

/** Options for resolving and updating a managed repo cache. */
export interface FetchUpdatesOptions {
  /** ATLAS repo identifier used only for diagnostics. */
  repoId: string;
  /** Persistent local checkout path. */
  localPath: string;
  /** Configured branch, tag, or commit-ish to fetch and resolve. */
  ref: string;
  /** Optional timeout applied to Git commands. */
  timeoutMs?: number | undefined;
}

/** Result of incremental update against the configured ref. */
export interface FetchUpdatesResult {
  /** Revision before fetch. */
  previousRevision: string;
  /** Revision after fetch and checkout. */
  currentRevision: string;
  /** True when the configured ref resolved to a different commit. */
  changed: boolean;
}

/**
 * Fetches the configured ref incrementally, checks it out, and reports whether
 * the resolved revision changed.
 */
export async function fetchUpdates(options: FetchUpdatesOptions): Promise<FetchUpdatesResult> {
  const previousRevision = await resolveCurrentRevision(options);
  await fetchRef(options);
  await checkoutRef(options);
  const currentRevision = await resolveCurrentRevision(options);

  return {
    previousRevision,
    currentRevision,
    changed: previousRevision !== currentRevision
  };
}

/**
 * Resolves HEAD in the managed checkout to a commit SHA.
 */
export async function resolveCurrentRevision(options: FetchUpdatesOptions): Promise<string> {
  const result = await spawnGit({
    cwd: options.localPath,
    args: ["rev-parse", "HEAD"],
    timeoutMs: options.timeoutMs
  });

  if (result.exitCode !== 0) {
    throw new GitRefResolutionError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: result.command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout
    });
  }

  const revision = parseRevisionOutput(result.stdout);
  if (revision.length === 0) {
    throw new GitRefResolutionError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: result.command,
      stderr: result.stderr,
      stdout: result.stdout
    });
  }
  return revision;
}

async function fetchRef(options: FetchUpdatesOptions): Promise<void> {
  const result = await spawnGit({
    cwd: options.localPath,
    args: ["fetch", "--prune", "origin", options.ref],
    timeoutMs: options.timeoutMs
  });

  if (result.exitCode !== 0) {
    if (isMissingRemoteRef(result.stderr)) {
      throw new GitRefResolutionError({
        repoId: options.repoId,
        localPath: options.localPath,
        command: result.command,
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout
      });
    }
    throw new GitFetchError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: result.command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout
    });
  }
}

function isMissingRemoteRef(stderr: string): boolean {
  return stderr.includes("couldn't find remote ref") || stderr.includes("could not find remote ref");
}

async function checkoutRef(options: FetchUpdatesOptions): Promise<void> {
  const result = await spawnGit({
    cwd: options.localPath,
    args: ["checkout", "--detach", "FETCH_HEAD"],
    timeoutMs: options.timeoutMs
  });

  if (result.exitCode !== 0) {
    throw new GitRefResolutionError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: result.command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout
    });
  }
}
