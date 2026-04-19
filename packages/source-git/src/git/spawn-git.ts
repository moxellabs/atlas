import { GitCommandFailedError, GitCommandTimeoutError, GitExecutableNotFoundError } from "./git-errors";

/** Structured output captured from a Git subprocess invocation. */
export interface GitCommandResult {
  /** Full command vector including the `git` executable. */
  command: string[];
  /** Working directory used for the subprocess. */
  cwd: string;
  /** Process exit code. */
  exitCode: number;
  /** UTF-8 decoded stdout. */
  stdout: string;
  /** UTF-8 decoded stderr. */
  stderr: string;
}

/** Options accepted by the low-level Git subprocess wrapper. */
export interface SpawnGitOptions {
  /** Directory in which Git should run. */
  cwd: string;
  /** Git arguments excluding the `git` executable. */
  args: readonly string[];
  /** Optional timeout after which the process is killed and reported as failed. */
  timeoutMs?: number | undefined;
}

/**
 * Runs Git with Bun's subprocess API and returns captured text output without
 * interpreting Git-specific business semantics.
 */
export async function spawnGit(options: SpawnGitOptions): Promise<GitCommandResult> {
  const command = ["git", ...options.args];

  let subprocess: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    subprocess = Bun.spawn(command, {
      cwd: options.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe"
    });
  } catch (cause) {
    if (isExecutableMissingError(cause)) {
      throw new GitExecutableNotFoundError({ command, localPath: options.cwd, cause });
    }
    throw new GitCommandFailedError({ command, localPath: options.cwd, cause });
  }

  const stdoutPromise = Bun.readableStreamToText(subprocess.stdout);
  const stderrPromise = Bun.readableStreamToText(subprocess.stderr);
  const exitPromise = waitForExit(subprocess, command, options);

  const [exitCode, stdout, stderr] = await Promise.all([exitPromise, stdoutPromise, stderrPromise]);

  return {
    command,
    cwd: options.cwd,
    exitCode,
    stdout,
    stderr
  };
}

/**
 * Runs Git and raises a generic command error on non-zero exit. Higher-level
 * modules wrap that error in operation-specific classes.
 */
export async function spawnGitOrThrow(options: SpawnGitOptions): Promise<GitCommandResult> {
  const result = await spawnGit(options);
  if (result.exitCode !== 0) {
    throw new GitCommandFailedError({
      command: result.command,
      exitCode: result.exitCode,
      localPath: result.cwd,
      stderr: result.stderr,
      stdout: result.stdout
    });
  }
  return result;
}

async function waitForExit(
  subprocess: Bun.Subprocess<"ignore", "pipe", "pipe">,
  command: string[],
  options: SpawnGitOptions
): Promise<number> {
  if (!options.timeoutMs) {
    return subprocess.exited;
  }

  let timeout: Timer | undefined;
  try {
    return await Promise.race([
      subprocess.exited,
      new Promise<number>((_, reject) => {
        timeout = setTimeout(() => {
          subprocess.kill();
          reject(
            new GitCommandTimeoutError({
              command,
              localPath: options.cwd,
              timeoutMs: options.timeoutMs
            })
          );
        }, options.timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isExecutableMissingError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}
