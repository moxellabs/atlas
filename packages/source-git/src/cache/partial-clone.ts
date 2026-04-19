import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { GitCloneError, GitInvalidRepositoryError } from "../git/git-errors";
import { spawnGit } from "../git/spawn-git";

/** Configuration required to create or inspect a managed repo cache. */
export interface PartialCloneOptions {
  /** ATLAS repo identifier used only for diagnostics. */
  repoId: string;
  /** Remote URL or local source path accepted by Git clone. */
  remote: string;
  /** Persistent local checkout path for the managed cache. */
  localPath: string;
  /** Branch, tag, or commit-ish to check out after cloning. */
  ref: string;
  /** Optional timeout applied to clone and checkout commands. */
  timeoutMs?: number | undefined;
}

/** Result of ensuring the initial managed cache exists. */
export interface PartialCloneResult {
  /** Persistent local checkout path. */
  localPath: string;
  /** True when this call performed the clone. */
  cloned: boolean;
}

/**
 * Ensures a managed cache exists, cloning with `--filter=blob:none` when the
 * target path is absent and validating existing paths without recloning.
 */
export async function ensurePartialClone(options: PartialCloneOptions): Promise<PartialCloneResult> {
  const exists = await pathExists(options.localPath);
  if (exists) {
    if (!(await isGitRepoPath(options.localPath))) {
      throw new GitInvalidRepositoryError({
        repoId: options.repoId,
        localPath: options.localPath
      });
    }
    return {
      localPath: options.localPath,
      cloned: false
    };
  }

  await ensureParentDirectory(options.localPath);
  await runClone(options);

  return {
    localPath: options.localPath,
    cloned: true
  };
}

/**
 * Returns true when a path exists and Git recognizes it as a work tree.
 */
export async function isGitRepoPath(localPath: string): Promise<boolean> {
  const result = await spawnGit({
    cwd: localPath,
    args: ["rev-parse", "--is-inside-work-tree"]
  }).catch(() => undefined);

  return result?.exitCode === 0 && result.stdout.trim() === "true";
}

async function ensureParentDirectory(localPath: string): Promise<void> {
  await mkdir(dirname(localPath), { recursive: true });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (cause) {
    if (isNotFoundError(cause)) {
      return false;
    }
    throw cause;
  }
}

async function runClone(options: PartialCloneOptions): Promise<void> {
  const parentPath = dirname(options.localPath);
  const args = ["clone", "--filter=blob:none", "--no-checkout", options.remote, options.localPath];
  const result = await spawnGit({
    cwd: parentPath,
    args,
    timeoutMs: options.timeoutMs
  });

  if (result.exitCode !== 0) {
    throw new GitCloneError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: result.command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout
    });
  }
}

/**
 * Checks out the configured ref after clone-time sparse-checkout decisions have
 * been applied.
 */
export async function checkoutCloneRef(options: PartialCloneOptions): Promise<void> {
  const fetchResult = await spawnGit({
    cwd: options.localPath,
    args: ["fetch", "origin", options.ref],
    timeoutMs: options.timeoutMs
  });

  if (fetchResult.exitCode !== 0) {
    throw new GitCloneError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: fetchResult.command,
      exitCode: fetchResult.exitCode,
      stderr: fetchResult.stderr,
      stdout: fetchResult.stdout
    });
  }

  const checkoutResult = await spawnGit({
    cwd: options.localPath,
    args: ["checkout", "--detach", "FETCH_HEAD"],
    timeoutMs: options.timeoutMs
  });

  if (checkoutResult.exitCode !== 0) {
    throw new GitCloneError({
      repoId: options.repoId,
      localPath: options.localPath,
      command: checkoutResult.command,
      exitCode: checkoutResult.exitCode,
      stderr: checkoutResult.stderr,
      stdout: checkoutResult.stdout
    });
  }
}

function isNotFoundError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}
